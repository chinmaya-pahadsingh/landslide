const mongoose = require('mongoose');
const LandslideEvent = require('../models/LandslideEvent');
const RainfallObservation = require('../models/RainfallObservation');
const SoilMoistureObservation = require('../models/SoilMoistureObservation');
const FieldReport = require('../models/FieldReport');
const InfrastructureAsset = require('../models/InfrastructureAsset');
const NewsItem = require('../models/NewsItem');
const { fuseEvidence } = require('../services/evidenceFusionService');
const { getTerrainFeaturesForLocation } = require('../services/terrainService');
const { calculateDistanceKm } = require('../utils/geoUtils');

// Constants for spatial/time semantics
const SEARCH_RADIUS_METERS = 50000; // 50 km for events/reports/infrastructure
const ENV_SEARCH_RADIUS_DEG = 0.45; // roughly 50km bounding box for collections without 2dsphere
const ENV_FRESHNESS_HOURS = 72; // observations older than 72 hours are ignored for fusion

const getAreaIntelligence = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const isSimulation = req.query.simulation === 'true';

    // B. Input validation
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Valid latitude [-90, 90] and longitude [-180, 180] are required.' });
    }

    const coordinates = [lon, lat]; // GeoJSON convention
    const now = new Date();
    const freshnessCutoff = new Date(now.getTime() - ENV_FRESHNESS_HOURS * 60 * 60 * 1000);

    // C & I. Spatial queries & Performance (Promise.all)
    const [
      terrainFeatures,
      nearbyEvents,
      nearbyFieldReports,
      nearbyInfrastructure,
      nearbyNews,
      rainfallSync,
      soilMoistureSync,
      satelliteLandCover
    ] = await Promise.all([
      // Terrain Data (safely isolated)
      getTerrainFeaturesForLocation(lat, lon).catch(err => {
        console.error('Terrain fetch failed:', err);
        return { elevation: null, slope: null, source: "unavailable" };
      }),

      // Historical Landslide Events (using 2dsphere)
      LandslideEvent.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates },
            $maxDistance: SEARCH_RADIUS_METERS
          }
        }
      })
      .limit(5)
      .lean(),

      // Field Reports (using 2dsphere)
      FieldReport.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates },
            $maxDistance: SEARCH_RADIUS_METERS
          }
        }
      })
      .limit(5)
      .lean(),

      // Infrastructure Assets (using 2dsphere)
      InfrastructureAsset.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates },
            $maxDistance: SEARCH_RADIUS_METERS
          }
        }
      })
      .limit(10)
      .lean(),

      // Relevant News (using 2dsphere, safely isolated)
      NewsItem.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates },
            $maxDistance: SEARCH_RADIUS_METERS
          }
        }
      })
      .sort({ publishedAt: -1 })
      .limit(5)
      .lean()
      .catch(err => {
        console.error('News fetch failed:', err);
        return [];
      }),

      // Rainfall sync
      (isSimulation 
        ? require('../services/rainfallIngestionService').syncRainfall(lat, lon, true)
        : require('../services/rainfallIngestionService').syncRainfall(lat, lon)
      ).catch(err => {
        console.error('Rainfall sync failed:', err);
        return { status: 'failed_upstream', dataMode: 'unavailable', freshness: 'unavailable', upstreamStatus: 'failed_upstream' };
      }),

      // Soil Moisture sync
      (isSimulation 
        ? require('../services/soilMoistureIngestionService').syncSoilMoisture(lat, lon, true)
        : require('../services/soilMoistureIngestionService').syncSoilMoisture(lat, lon)
      ).catch(err => {
        console.error('Soil moisture sync failed:', err);
        return { status: 'failed_upstream', dataMode: 'unavailable', freshness: 'unavailable', upstreamStatus: 'failed_upstream' };
      }),

      // Satellite Land Cover (safely isolated)
      require('../services/satelliteLandCoverService').satelliteLandCoverService.getLandCover(lat, lon).catch(err => {
        console.error('Satellite land cover fetch failed:', err);
        return { available: false, source: 'satellite_error', error: err.message };
      })
    ]);

    // Map sync results to array format expected by the rest of the system
    const rainfallObs = rainfallSync.data ? [
      {
        ...(rainfallSync.data.toObject ? rainfallSync.data.toObject() : rainfallSync.data),
        weatherTelemetry: rainfallSync.data.weatherTelemetry || null,
        freshness: rainfallSync.freshness,
        dataMode: rainfallSync.dataMode,
        upstreamStatus: rainfallSync.upstreamStatus,
        isStale: rainfallSync.freshness === 'stale'
      }
    ] : [];
    const soilMoistureObs = soilMoistureSync.data ? [
      {
        ...(soilMoistureSync.data.toObject ? soilMoistureSync.data.toObject() : soilMoistureSync.data),
        freshness: soilMoistureSync.freshness,
        dataMode: soilMoistureSync.dataMode,
        upstreamStatus: soilMoistureSync.upstreamStatus,
        isStale: soilMoistureSync.freshness === 'stale'
      }
    ] : [];

    // E. Extract ML Features and request Prediction from trained production models
    // We strictly use exactly what was fetched. Missing dynamic features or terrain are passed truthfully without zero-substitution.
    const { predictSusceptibility } = require('../services/mlPredictionService');

    let mlPrediction = null;

    // Production: Execute trained XGBoost models in data/ml/
      const elevation = terrainFeatures?.elevation;
      const slope = terrainFeatures?.slope;
      const hasTerrain = (
        typeof elevation === 'number' && Number.isFinite(elevation) &&
        typeof slope === 'number' && Number.isFinite(slope) &&
        typeof lat === 'number' && Number.isFinite(lat) &&
        typeof lon === 'number' && Number.isFinite(lon)
      );

      if (hasTerrain) {
        try {
          const suscResult = await predictSusceptibility({
            elevation_m: elevation,
            slope_deg: slope,
            latitude: lat,
            longitude: lon
          });

          const trigResult = {
            status: 'skipped',
            model: 'xgboost_trigger',
            reason: 'Multi-scale antecedent precipitation (3d/7d/30d) time-series incomplete; trigger prediction skipped without fabricating data.'
          };

          if (suscResult.status === 'success') {
            const prob = suscResult.probability;
            const predClass = prob >= 0.5 ? 1 : 0;
            const riskLevel = prob >= 0.75 ? 'critical' : prob >= 0.5 ? 'high' : prob >= 0.25 ? 'medium' : 'low';

            mlPrediction = {
              status: 'success',
              modelVersion: '1.0.0',
              modelType: 'XGBoost Static Susceptibility',
              prediction: {
                probability: prob,
                class: predClass,
                riskLevel
              },
              susceptibility: suscResult,
              trigger: trigResult,
              limitations: [
                'Susceptibility model is trained on 20,472 GSI landslide inventory records across North-East India (Copernicus DEM 90m features).',
                trigResult.reason
              ],
              generatedAt: new Date().toISOString()
            };
          } else {
            mlPrediction = {
              status: suscResult.status === 'validation_error' ? 'validation_error' : 'unavailable',
              reason: suscResult.reason || 'Inference service could not evaluate susceptibility model.',
              modelVersion: '1.0.0'
            };
          }
        } catch (mlErr) {
          mlPrediction = {
            status: 'error',
            reason: `ML execution error: ${mlErr.message}`,
            modelVersion: '1.0.0'
          };
        }
      } else {
        mlPrediction = {
          status: 'prediction_refused',
          reason: 'Required terrain features (elevation/slope) are unavailable for ML susceptibility prediction.',
          modelVersion: '1.0.0'
        };
      }

    // F. Evidence fusion (Reuse existing service)
    const fusionInput = {
      location: { latitude: lat, longitude: lon },
      terrain: terrainFeatures,
      rainfallObservations: rainfallObs,
      soilMoistureObservations: soilMoistureObs,
      historicalEvents: nearbyEvents,
      fieldReports: nearbyFieldReports,
      mlPrediction, // Integrate ML prediction strictly as evidence
      satellite: satelliteLandCover,
      referenceTime: now
    };

    const fusionResult = fuseEvidence(fusionInput);

    // Infrastructure Operational Priority
    const { calculateOperationalPriority } = require('../services/infrastructurePriorityService');
    const { calculateRiskScore } = require('../services/riskScoreService');

    // Determine hazard context if valid fresh/recent environmental data is present
    let hazardContext = 'none';
    const evRainfall = fusionResult.evidence?.rainfall;
    const evSoil = fusionResult.evidence?.soilMoisture;
    const isRainfallValid = evRainfall && evRainfall.isRecent && typeof evRainfall.latestValue === 'number' && isFinite(evRainfall.latestValue);
    const isSoilValid = evSoil && evSoil.isRecent && typeof evSoil.latestValue === 'number' && isFinite(evSoil.latestValue);

    if (isRainfallValid && isSoilValid) {
      const envBaseline = calculateRiskScore({
        rainfall: evRainfall.latestValue,
        soilMoisture: evSoil.latestValue
      });
      if (envBaseline && envBaseline.level) {
        hazardContext = envBaseline.level;
      }
    }

    let enrichedInfrastructure = [];
    let infraPriority = { status: 'insufficient_data' };

    if (nearbyInfrastructure && nearbyInfrastructure.length > 0) {
      enrichedInfrastructure = nearbyInfrastructure.map(asset => {
        const priority = calculateOperationalPriority({
          importance: asset.importance,
          populationServed: asset.populationServed,
          alternativeAvailable: asset.alternativeAvailable,
          status: asset.status,
          hazardContext
        });
        const distanceKm = asset.location?.latitude != null && asset.location?.longitude != null
          ? calculateDistanceKm(lat, lon, asset.location.latitude, asset.location.longitude)
          : null;
        return {
          ...asset,
          distanceKm,
          operationalPriority: priority
        };
      });

      // Sort assets by operational priority score descending.
      // Assets with calculated scores are placed first (highest score to lowest score),
      // followed by assets with insufficient_data.
      enrichedInfrastructure.sort((a, b) => {
        const scoreA = a.operationalPriority?.status === 'calculated' && typeof a.operationalPriority.score === 'number'
          ? a.operationalPriority.score
          : -1;
        const scoreB = b.operationalPriority?.status === 'calculated' && typeof b.operationalPriority.score === 'number'
          ? b.operationalPriority.score
          : -1;
        return scoreB - scoreA;
      });

      const calculatedPriorities = enrichedInfrastructure
        .map(a => a.operationalPriority)
        .filter(p => p && p.status === 'calculated');

      if (calculatedPriorities.length > 0) {
        const maxScore = Math.max(...calculatedPriorities.map(p => p.score));
        infraPriority = { status: 'calculated', score: maxScore };
      }
    }

    const enrichedEvents = nearbyEvents.map(e => ({
      ...e,
      distanceKm: e.location?.latitude != null && e.location?.longitude != null
        ? calculateDistanceKm(lat, lon, e.location.latitude, e.location.longitude)
        : null
    }));

    const enrichedFieldReports = nearbyFieldReports.map(r => ({
      ...r,
      distanceKm: r.location?.latitude != null && r.location?.longitude != null
        ? calculateDistanceKm(lat, lon, r.location.latitude, r.location.longitude)
        : null
    }));

    // G. Final Risk Decision (Early Warning Evaluation)
    const { evaluateEarlyWarning } = require('../services/earlyWarningService');
    const { notifyEarlyWarning } = require('../services/notificationService');
    const earlyWarning = evaluateEarlyWarning({
      location: { latitude: lat, longitude: lon },
      evidence: fusionResult.evidence,
      infrastructure: infraPriority,
      referenceTime: now
    });

    // Safely trigger downstream notification if applicable, isolated so DB failure doesn't affect response
    try {
      notifyEarlyWarning(earlyWarning).catch(err => {
        console.error('Non-fatal error creating downstream early warning notification in area intelligence:', err);
      });
    } catch (err) {
      console.error('Non-fatal error initiating early warning notification in area intelligence:', err);
    }

    // H. Response structure
    const responsePayload = {
      selectedLocation: { latitude: lat, longitude: lon },
      searchRadiusMeters: SEARCH_RADIUS_METERS,
      providerStatus: {
        rainfall: {
          dataMode: rainfallSync.dataMode,
          freshness: rainfallSync.freshness,
          upstreamStatus: rainfallSync.upstreamStatus
        },
        soilMoisture: {
          dataMode: soilMoistureSync.dataMode,
          freshness: soilMoistureSync.freshness,
          upstreamStatus: soilMoistureSync.upstreamStatus
        },
        terrain: terrainFeatures.source === 'unavailable' ? 'unavailable' : 'success'
      },
      evidenceAvailability: fusionResult.evidenceAvailability,
      earlyWarning,
      evidenceFusion: fusionResult,
      mlPrediction,
      satelliteEvidence: satelliteLandCover,
      weather: (rainfallSync.data?.weatherTelemetry || (rainfallObs.length > 0 && rainfallObs[0].weatherTelemetry)) ? {
        temperature: (rainfallSync.data?.weatherTelemetry || rainfallObs[0].weatherTelemetry).temperature ?? null,
        humidity: (rainfallSync.data?.weatherTelemetry || rainfallObs[0].weatherTelemetry).humidity ?? null,
        windSpeed: (rainfallSync.data?.weatherTelemetry || rainfallObs[0].weatherTelemetry).windSpeed ?? null,
        precipitationProbability: (rainfallSync.data?.weatherTelemetry || rainfallObs[0].weatherTelemetry).precipitationProbability ?? null,
        source: 'open-meteo'
      } : null,
      nearbyInfrastructure: enrichedInfrastructure,
      relevantNews: nearbyNews || [],
      // Pass along the raw contextual data if frontend wants to render lists
      contextualData: {
        terrain: terrainFeatures,
        rainfall: rainfallObs,
        soilMoisture: soilMoistureObs,
        satellite: satelliteLandCover,
        historicalEvents: enrichedEvents,
        fieldReports: enrichedFieldReports,
        infrastructure: enrichedInfrastructure,
        news: nearbyNews || [],
        mlPrediction
      },
      retrievedAt: now.toISOString()
    };

    res.status(200).json(responsePayload);

  } catch (error) {
    console.error('Area Intelligence Error:', error);
    // J. Reliability: return predictable JSON errors
    res.status(500).json({ error: 'An unexpected server error occurred while retrieving area intelligence.' });
  }
};

module.exports = {
  getAreaIntelligence
};
