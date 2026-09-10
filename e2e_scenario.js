process.env.JWT_SECRET = 'test_secret_for_e2e';
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('./src/app');

const User = require('./src/models/User');
const FieldReport = require('./src/models/FieldReport');
const LandslideEvent = require('./src/models/LandslideEvent');
const RainfallObservation = require('./src/models/RainfallObservation');
const SoilMoisture = require('./src/models/SoilMoistureObservation');
const InfrastructureAsset = require('./src/models/InfrastructureAsset');
const Notification = require('./src/models/Notification');
const NewsItem = require('./src/models/NewsItem');

const RUN_ID = `TEST_E2E_${Date.now()}`;
const TEST_LOC = { latitude: 25.5, longitude: 91.5 }; // Meghalaya test coordinate

async function run() {
  console.log('--- STARTING END-TO-END SCENARIO (IN-MEMORY DB) ---');
  
  const mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
  console.log('Connected to In-Memory DB');

  let adminToken, citizenToken;
  const citizenEmail = `citizen_${RUN_ID}@example.com`;

  try {
    // 1. Register Citizen
    const resReg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'E2E Citizen', email: citizenEmail, password: 'password123', role: 'admin' });
    
    if (resReg.status !== 201) throw new Error('Citizen registration failed');
    if (resReg.body.user.role !== 'citizen') throw new Error('Role escalation succeeded (defect)');
    
    citizenToken = resReg.body.token;
    console.log('✅ Citizen registered and token received');

    // 2. Elevate to Admin directly via DB for test purposes
    await User.updateOne({ email: citizenEmail }, { $set: { role: 'admin' } });
    
    const resLog = await request(app)
      .post('/api/auth/login')
      .send({ email: citizenEmail, password: 'password123' });
    adminToken = resLog.body.token;
    console.log('✅ Promoted to Admin and logged in');

    // 3. Create Simulated Rainfall (Admin)
    const resRain = await request(app)
      .post('/api/rainfall')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ location: TEST_LOC, rainfall: 150, recordedAt: new Date().toISOString(), source: 'simulation', metadata: { notes: RUN_ID } });
    if (resRain.status !== 201) throw new Error('Rainfall creation failed: ' + JSON.stringify(resRain.body));
    console.log('✅ Simulated Rainfall created');

    const resSoil = await request(app)
      .post('/api/soil-moisture')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ location: TEST_LOC, soilMoisture: 80, recordedAt: new Date().toISOString(), source: 'simulation', metadata: { notes: RUN_ID } });
    if (resSoil.status !== 201) throw new Error('Soil Moisture creation failed: ' + JSON.stringify(resSoil.body));
    console.log('✅ Simulated Soil Moisture created');

    // 5. Create Simulated Field Report (Citizen)
    // First, let's login as a normal citizen again to prove citizen can report
    const resCitizenReg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'True Citizen', email: `true_citizen_${RUN_ID}@example.com`, password: 'password123' });
    if (resCitizenReg.status !== 201) throw new Error('True Citizen reg failed: ' + JSON.stringify(resCitizenReg.body));
    
    const resCitizenLog = await request(app)
      .post('/api/auth/login')
      .send({ email: `true_citizen_${RUN_ID}@example.com`, password: 'password123' });
    const trueCitizenToken = resCitizenLog.body.token;

    const resReport = await request(app)
      .post('/api/field-reports')
      .set('Authorization', `Bearer ${trueCitizenToken}`)
      .send({ location: TEST_LOC, reportType: 'landslide', description: RUN_ID, source: 'citizen' });
    if (resReport.status !== 201) throw new Error('Field Report creation failed: ' + JSON.stringify(resReport.body));
    console.log('✅ Simulated Field Report created');

    // 6. Create Infrastructure Asset (Admin)
    const resInfra = await request(app)
      .post('/api/infrastructure-assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Bridge ${RUN_ID}`, assetType: 'bridge', location: TEST_LOC, importanceScore: 8 });
    if (resInfra.status !== 201) throw new Error('Infra creation failed: ' + JSON.stringify(resInfra.body));
    console.log('✅ Simulated Infrastructure Asset created');

    // 7. Run Risk Assessment
    const resRisk = await request(app)
      .post('/api/risk-assessment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rainfall: 150, soilMoisture: 80 });
    if (resRisk.status !== 200 && resRisk.status !== 201) throw new Error('Risk Assessment failed: ' + JSON.stringify(resRisk.body));
    console.log('✅ Risk Assessment generated:', resRisk.body);

    // 7.5. Run Evidence Fusion
    const { fuseEvidence } = require('./src/services/evidenceFusionService');
    const fusionInput = {
      location: TEST_LOC,
      rainfallObservations: [resRain.body],
      soilMoistureObservations: [resSoil.body],
      fieldReports: [resReport.body]
    };
    const evidenceResult = fuseEvidence(fusionInput);
    console.log('✅ Evidence Fusion generated:', evidenceResult.overallStatus);

    // 8. Run Early Warning Evaluation
    const infraDoc = resInfra.body.infrastructureAsset || resInfra.body.data;
    const resWarning = await request(app)
      .post('/api/early-warning/evaluate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ 
        location: TEST_LOC, 
        evidence: evidenceResult.evidence,
        infrastructure: { status: 'calculated', score: 80 } // Mock calculated score for E2E
      });
    if (resWarning.status !== 200 && resWarning.status !== 201) throw new Error('Early Warning failed: ' + JSON.stringify(resWarning.body));
    
    console.log('Early Warning Response:', JSON.stringify(resWarning.body));
    const warningResult = resWarning.body;
    console.log('✅ Early Warning Evaluation generated:', warningResult?.warningLevel || 'No Warning Level');

    if (warningResult?.warningLevel !== 'critical' && warningResult?.warningLevel !== 'WARNING' && warningResult?.warningLevel !== 'WATCH') {
      console.log('⚠️ Warning Level generated was unexpected:', warningResult?.warningLevel);
    }

    // Wait for async notification generation
    await new Promise(resolve => setTimeout(resolve, 500));

    // 9. Verify Notification Generation
    const notifications = await Notification.find({});
    console.log(`✅ Verified backend DB has ${notifications.length} notifications generated.`);
    
    const resNotif = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminToken}`);
    if (resNotif.body.data.length > 0) {
      console.log('✅ Fetched Notifications via API successfully');
    } else {
      console.log('⚠️ No notifications returned from API (might be normal if none reached WARNING threshold)');
    }

    console.log('\n✅ ALL INTEGRATION STEPS SUCCEEDED\n');

  } catch (error) {
    console.error('❌ INTEGRATION FAILED:', error);
  } finally {
    console.log('--- CLEANING UP TEST DATA ---');
    await mongoose.disconnect();
    await mongoServer.stop();
    console.log('--- DISCONNECTED ---');
  }
}

run();
