const Notification = require('./Notification');
const mongoose = require('mongoose');

const tests = [
  {
    label: 'Valid notification (minimal)',
    input: {
      type: 'warning',
      severity: 'critical',
      priority: 'high',
      title: 'High Risk Warning',
      message: 'Evacuate immediately.'
    },
    shouldFail: false
  },
  {
    label: 'Valid notification (complete)',
    input: {
      type: 'warning',
      severity: 'warning',
      priority: 'medium',
      title: 'Heavy Rainfall Alert',
      message: 'Prepare for possible slope failures.',
      location: { latitude: 25.0, longitude: 92.0, name: 'Shillong' },
      source: { type: 'early_warning_system', referenceId: 'ew-123' },
      isRead: true,
      deduplicationKey: 'warning_shillong_20231010',
      metadata: { anyKey: 'anyValue' }
    },
    shouldFail: false
  },
  {
    label: 'Missing required title',
    input: {
      type: 'warning',
      severity: 'advisory',
      priority: 'low',
      message: 'Some message'
    },
    shouldFail: true
  },
  {
    label: 'Missing required message',
    input: {
      type: 'warning',
      severity: 'advisory',
      priority: 'low',
      title: 'Some title'
    },
    shouldFail: true
  },
  {
    label: 'Invalid type rejected',
    input: {
      type: 'unsupported_type',
      severity: 'advisory',
      priority: 'low',
      title: 'A',
      message: 'B'
    },
    shouldFail: true
  },
  {
    label: 'Invalid severity rejected',
    input: {
      type: 'warning',
      severity: 'invalid_severity',
      priority: 'low',
      title: 'A',
      message: 'B'
    },
    shouldFail: true
  },
  {
    label: 'Invalid priority rejected',
    input: {
      type: 'warning',
      severity: 'advisory',
      priority: 'invalid_priority',
      title: 'A',
      message: 'B'
    },
    shouldFail: true
  },
  {
    label: 'Invalid location latitude rejected',
    input: {
      type: 'warning',
      severity: 'advisory',
      priority: 'low',
      title: 'A',
      message: 'B',
      location: { latitude: 95, longitude: 90 }
    },
    shouldFail: true
  }
];

function runTests() {
  let passed = 0;
  let failed = 0;
  
  console.log('=== Notification Model — Verification ===\n');

  for (const t of tests) {
    const doc = new Notification(t.input);
    const err = doc.validateSync();
    
    if (t.shouldFail) {
      if (err) {
        console.log(`  PASS  ${t.label}`);
        passed++;
      } else {
        console.log(`  FAIL  ${t.label} (Expected to fail but succeeded)`);
        failed++;
      }
    } else {
      if (err) {
        console.log(`  FAIL  ${t.label} (Unexpected error: ${err.message})`);
        failed++;
      } else {
        console.log(`  PASS  ${t.label}`);
        passed++;
      }
    }
  }

  try {
    const doc = new Notification({
      type: 'system',
      severity: 'info',
      priority: 'low',
      title: 'A',
      message: 'B'
    });
    
    if (doc.isRead === false) {
      console.log(`  PASS  Default isRead is false`);
      passed++;
    } else {
      console.log(`  FAIL  Default isRead is not false`);
      failed++;
    }
  } catch (err) {
    console.log(`  FAIL  Default check threw error: ${err.message}`);
    failed++;
  }

  console.log(`\n=== Total Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
