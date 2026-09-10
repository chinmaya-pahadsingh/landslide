const mongoose = require('mongoose');
require('dotenv').config();

const InfrastructureAsset = require('../models/InfrastructureAsset');
const Notification = require('../models/Notification');

const INITIAL_INFRASTRUCTURE = [
  {
    name: 'NH-6 Shillong-Silchar Mountain Corridor',
    assetType: 'road',
    location: { latitude: 25.5788, longitude: 91.8933, name: 'East Khasi Hills, Meghalaya' },
    importance: 5,
    populationServed: 450000,
    status: 'active',
    alternativeAvailable: true,
    condition: 'fair'
  },
  {
    name: 'NH-10 Siliguri-Gangtok Highway (Teesta Valley)',
    assetType: 'road',
    location: { latitude: 27.3389, longitude: 88.6065, name: 'East Sikkim' },
    importance: 5,
    populationServed: 350000,
    status: 'active',
    alternativeAvailable: false,
    condition: 'vulnerable'
  },
  {
    name: 'NH-27 Guwahati-Nagaon National Expressway',
    assetType: 'road',
    location: { latitude: 26.1445, longitude: 91.7362, name: 'Kamrup Metropolitan, Assam' },
    importance: 5,
    populationServed: 1200000,
    status: 'active',
    alternativeAvailable: true,
    condition: 'good'
  },
  {
    name: 'NH-29 Dimapur-Kohima Hill Pass',
    assetType: 'road',
    location: { latitude: 25.6751, longitude: 94.1086, name: 'Kohima District, Nagaland' },
    importance: 4,
    populationServed: 280000,
    status: 'active',
    alternativeAvailable: true,
    condition: 'fair'
  },
  {
    name: 'NH-54 Aizawl-Lunglei Mountain Highway',
    assetType: 'road',
    location: { latitude: 23.7271, longitude: 92.7176, name: 'Aizawl District, Mizoram' },
    importance: 4,
    populationServed: 210000,
    status: 'active',
    alternativeAvailable: false,
    condition: 'fair'
  },
  {
    name: 'Tawang-Bumla Himalayan Access Route',
    assetType: 'road',
    location: { latitude: 27.5861, longitude: 91.8679, name: 'Tawang, Arunachal Pradesh' },
    importance: 5,
    populationServed: 85000,
    status: 'active',
    alternativeAvailable: false,
    condition: 'vulnerable'
  },
  {
    name: 'NH-102 Imphal-Moreh Border Highway',
    assetType: 'road',
    location: { latitude: 24.8170, longitude: 93.9368, name: 'Imphal, Manipur' },
    importance: 4,
    populationServed: 320000,
    status: 'active',
    alternativeAvailable: true,
    condition: 'good'
  },
  {
    name: 'Bogibeel Rail-Road Lifeline Bridge',
    assetType: 'bridge',
    location: { latitude: 27.4728, longitude: 94.9120, name: 'Dibrugarh, Assam' },
    importance: 5,
    populationServed: 800000,
    status: 'active',
    alternativeAvailable: true,
    condition: 'good'
  }
];

const INITIAL_NOTIFICATIONS = [
  {
    title: 'IMD Monsoon Landslide Advisory — East Khasi Hills',
    message: 'Persistent heavy rainfall (>115mm) recorded across Sohra and Shillong plateau. Saturated slopes along NH-6 require reduced transit speeds and vigilance for mudslides.',
    severity: 'warning',
    priority: 'high',
    type: 'warning',
    location: { latitude: 25.5788, longitude: 91.8933, name: 'Shillong / Cherrapunji, Meghalaya' },
    source: { type: 'early_warning_system', referenceId: 'IMD-EKH-001' },
    isRead: false
  },
  {
    title: 'Geological Slope Watch — Teesta Valley / Gangtok Corridor',
    message: 'Soil saturation threshold reached 65% in East Sikkim slopes. GSI automated sensor array active. Avoid non-essential night transit on NH-10.',
    severity: 'warning',
    priority: 'high',
    type: 'warning',
    location: { latitude: 27.3389, longitude: 88.6065, name: 'Gangtok, East Sikkim' },
    source: { type: 'early_warning_system', referenceId: 'GSI-E-SIKKIM-002' },
    isRead: false
  },
  {
    title: 'Regional Meteorological Ingestion Node Active',
    message: 'Open-Meteo real-time atmospheric and soil telemetry node successfully synchronized for Northeast India command grid.',
    severity: 'info',
    priority: 'low',
    type: 'system',
    location: { latitude: 26.1445, longitude: 91.7362, name: 'Guwahati Regional Node' },
    source: { type: 'system', referenceId: 'OPENMETEO-SYNC-003' },
    isRead: false
  }
];

async function seed() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI is not set');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Seed infrastructure if count is 0
    const existingAssets = await InfrastructureAsset.countDocuments();
    if (existingAssets === 0) {
      console.log('Seeding initial infrastructure assets...');
      for (const asset of INITIAL_INFRASTRUCTURE) {
        await InfrastructureAsset.create(asset);
      }
      console.log(`Seeded ${INITIAL_INFRASTRUCTURE.length} infrastructure assets.`);
    } else {
      console.log(`Infrastructure assets already present: ${existingAssets}`);
    }

    // Seed notifications if count is 0
    const existingNotifs = await Notification.countDocuments();
    if (existingNotifs === 0) {
      console.log('Seeding initial early warning notifications...');
      for (const notif of INITIAL_NOTIFICATIONS) {
        await Notification.create(notif);
      }
      console.log(`Seeded ${INITIAL_NOTIFICATIONS.length} notifications.`);
    } else {
      console.log(`Notifications already present: ${existingNotifs}`);
    }

    await mongoose.disconnect();
    console.log('Seeding complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
