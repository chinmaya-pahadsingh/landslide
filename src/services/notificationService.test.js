const { 
  createNotification, 
  notifyEarlyWarning, 
  getNotifications, 
  markAsRead, 
  markAllAsRead 
} = require('./notificationService');
const Notification = require('../models/Notification');

// Mock Mongoose Methods
let mockDb = [];
let callHistory = [];

Notification.findOne = async (query) => {
  callHistory.push({ method: 'findOne', query });
  if (query.deduplicationKey) {
    return mockDb.find(n => n.deduplicationKey === query.deduplicationKey) || null;
  }
  return null;
};

Notification.prototype.save = async function() {
  callHistory.push({ method: 'save', doc: this });
  if (this.deduplicationKey && mockDb.some(n => n.deduplicationKey === this.deduplicationKey)) {
    const err = new Error('E11000 duplicate key error');
    err.code = 11000;
    throw err;
  }
  mockDb.push(this);
  return this;
};

Notification.countDocuments = async (query) => {
  return mockDb.filter(n => {
    if (query.isRead !== undefined && n.isRead !== query.isRead) return false;
    return true;
  }).length;
};

Notification.find = (query) => {
  return {
    sort: () => ({
      skip: () => ({
        limit: () => mockDb.filter(n => {
          if (query.isRead !== undefined && n.isRead !== query.isRead) return false;
          return true;
        })
      })
    })
  };
};

Notification.findByIdAndUpdate = async (id, update) => {
  const doc = mockDb.find(n => n._id && n._id.toString() === id.toString());
  if (doc) {
    Object.assign(doc, update);
    return doc;
  }
  return null;
};

Notification.updateMany = async (query, update) => {
  let count = 0;
  mockDb.forEach(n => {
    if (query.isRead === false && n.isRead === false) {
      if (update.$set) Object.assign(n, update.$set);
      count++;
    }
  });
  return { modifiedCount: count };
};

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    return true;
  }
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  const check = (cond, label, detail) => {
    if (assert(cond, label, detail)) passed++;
    else failed++;
  };

  console.log('=== Notification Service — Verification ===\n');

  try {
    mockDb = [];
    
    // 1. Create valid notification
    {
      const res = await createNotification({
        type: 'system',
        severity: 'info',
        priority: 'low',
        title: 'System Boot',
        message: 'All systems go'
      });
      check(res.success === true, 'Create valid notification');
      check(res.isDuplicate === false, 'New notification is not marked duplicate');
    }

    // 2. Reject invalid input
    {
      const res = await createNotification({ type: 'system' });
      check(res.success === false, 'Reject invalid input (missing required fields)');
    }

    // Scenario A: Same location, severity, notification type, day
    {
      const data = {
        type: 'warning',
        severity: 'critical',
        priority: 'high',
        title: 'Scenario A',
        message: 'Message',
        deduplicationKey: 'key_scenario_a'
      };
      const res1 = await createNotification(data);
      const res2 = await createNotification(data);
      check(res1.success === true && !res1.isDuplicate, 'Scenario A: First deduplicated notification created');
      check(res2.success === true && res2.isDuplicate === true, 'Scenario A: Duplicate identical notification successfully caught and suppressed');
    }

    // Scenario B: Escalation creates a NEW notification
    {
      const decisionWatch = { decisionStatus: 'success', warningLevel: 'watch', location: { latitude: 25.111, longitude: 92.111 }, triggers: [{ detail: 'Trigger' }] };
      const decisionWarning = { decisionStatus: 'success', warningLevel: 'warning', location: { latitude: 25.111, longitude: 92.111 }, triggers: [{ detail: 'Trigger' }] };
      
      const res1 = await notifyEarlyWarning(decisionWatch);
      const res2 = await notifyEarlyWarning(decisionWarning);
      
      check(res1.success === true && !res1.isDuplicate, 'Scenario B: Watch notification created');
      check(res2.success === true && !res2.isDuplicate, 'Scenario B: Warning escalation creates separate notification');
    }

    // Scenario C: Same warning but different location
    {
      const decisionLoc1 = { decisionStatus: 'success', warningLevel: 'critical', location: { latitude: 25.111, longitude: 92.111 }, triggers: [{ detail: 'Trigger' }] };
      const decisionLoc2 = { decisionStatus: 'success', warningLevel: 'critical', location: { latitude: 26.111, longitude: 93.111 }, triggers: [{ detail: 'Trigger' }] };
      
      const res1 = await notifyEarlyWarning(decisionLoc1);
      const res2 = await notifyEarlyWarning(decisionLoc2);
      
      check(res1.success === true && !res1.isDuplicate, 'Scenario C: Location 1 notification created');
      check(res2.success === true && !res2.isDuplicate, 'Scenario C: Different location creates separate notification');
    }

    // Scenario D: Different notification types
    {
      const data1 = { type: 'warning', severity: 'critical', priority: 'high', title: 'Scenario D', message: 'Message', deduplicationKey: 'key_d_1' };
      const data2 = { type: 'news', severity: 'critical', priority: 'high', title: 'Scenario D', message: 'Message', deduplicationKey: 'key_d_2' };
      
      const res1 = await createNotification(data1);
      const res2 = await createNotification(data2);
      
      check(res1.success === true && !res1.isDuplicate, 'Scenario D: Warning type notification created');
      check(res2.success === true && !res2.isDuplicate, 'Scenario D: News type notification with different deduplication key created separately');
    }

    // Scenario E: Simultaneous duplicate requests
    {
      const data = { type: 'warning', severity: 'critical', priority: 'high', title: 'Scenario E', message: 'Message', deduplicationKey: 'key_scenario_e' };
      
      // Simulate race condition by avoiding the findOne check sequentially
      // In my mock, if I do Promise.all, they might hit `save` at the same time.
      const p1 = createNotification(data);
      const p2 = createNotification(data);
      
      const results = await Promise.all([p1, p2]);
      
      const successCount = results.filter(r => r.success === true && !r.isDuplicate).length;
      const dupCount = results.filter(r => r.success === true && r.isDuplicate === true).length;
      
      check(successCount === 1, 'Scenario E: Only one notification created during simultaneous requests');
      check(dupCount === 1, 'Scenario E: One request caught as duplicate');
    }

    // 5. Early Warning ignores NO_WARNING and ADVISORY
    {
      const resAdvisory = await notifyEarlyWarning({
        decisionStatus: 'success',
        warningLevel: 'advisory',
        location: { latitude: 25.111, longitude: 92.111 }
      });
      check(resAdvisory.success === true && resAdvisory.reason.includes('not high enough'), 'Advisory level early warnings are safely ignored');

      const resNoWarning = await notifyEarlyWarning({
        decisionStatus: 'success',
        warningLevel: 'no_warning',
        location: { latitude: 25.111, longitude: 92.111 }
      });
      check(resNoWarning.success === true && resNoWarning.reason.includes('not high enough'), 'No-warning level early warnings are safely ignored');
    }

    // 6. DB failure isolation
    {
      const originalFindOne = Notification.findOne;
      Notification.findOne = async () => {
        throw new Error('Simulated Database Outage');
      };

      const decisionWarning = {
        decisionStatus: 'success',
        warningLevel: 'critical',
        location: { latitude: 25.111, longitude: 92.111 },
        triggers: [{ detail: 'Trigger' }]
      };

      const resDbFail = await notifyEarlyWarning(decisionWarning);
      check(resDbFail.success === false && resDbFail.reason === 'Database error', 'Database error is caught and isolated safely without throwing');

      // Restore
      Notification.findOne = originalFindOne;
    }

    // 7. Malformed decision input handled safely
    {
      const resNull = await notifyEarlyWarning(null);
      check(resNull.success === false && resNull.reason.includes('Invalid'), 'Null decision handled safely');

      const resNonObj = await notifyEarlyWarning('invalid');
      check(resNonObj.success === false && resNonObj.reason.includes('Invalid'), 'Non-object decision handled safely');

      const resErrDecision = await notifyEarlyWarning({ decisionStatus: 'error' });
      check(resErrDecision.success === false && resErrDecision.reason.includes('Invalid'), 'Error status decision handled safely');
    }

  } catch (err) {
    console.error('Test suite failed:', err);
    failed++;
  }

  console.log(`\n=== Total Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
