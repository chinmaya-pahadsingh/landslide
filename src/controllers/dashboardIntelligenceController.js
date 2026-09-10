const LandslideEvent = require('../models/LandslideEvent');
const FieldReport = require('../models/FieldReport');
const InfrastructureAsset = require('../models/InfrastructureAsset');
const OpenMeteoProvider = require('../services/weatherProviders/openMeteoProvider');
const soilMoistureIngestionService = require('../services/soilMoistureIngestionService');
const { getTerrainFeaturesForLocation } = require('../services/terrainService');
const { fuseEvidence } = require('../services/evidenceFusionService');
const { calculateOperationalPriority } = require('../services/infrastructurePriorityService');
const { calculateRiskScore } = require('../services/riskScoreService');
const { calculateDistanceKm } = require('../utils/geoUtils');
const { satelliteLandCoverService } = require('../services/satelliteLandCoverService');

const SEARCH_RADIUS_METERS = 50000; // 50 km search radius

/**
 * Controller to provide comprehensive, location-aware intelligence for the Authority Dashboard.
 * Publicly accessible to support full location-aware views for any geocoded location.
 */
const getDashboardIntelligence = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Valid latitude [-90, 90] and longitude [-180, 180] are required.' });
    }

    const coordinates = [lon, lat];
    const now = new Date();

    // 1. Concurrently fetch all location-specific dependencies
    const [
      weatherResult,
      soilMoistureSync,
      terrainFeatures,
      nearbyEvents,
      nearbyReports,
      nearbyAssets,
      satelliteLandCover
    ] = await Promise.all([
      // Real Open-Meteo weather fetch
      OpenMeteoProvider.fetchWeather(lat, lon)
        .then(data => ({
          status: 'success',
          dataMode: 'live',
          freshness: 'fresh',
          data
        }))
        .catch(err => {
          console.error(`Weather fetch failed for [${lat}, ${lon}]:`, err.message);
          return {
            status: 'failed_upstream',
            dataMode: 'unavailable',
            freshness: 'unavailable',
            data: null
          };
        }),

      // Soil Moisture sync
      soilMoistureIngestionService.syncSoilMoisture(lat, lon)
        .catch(err => {
          console.error(`Soil moisture sync failed for [${lat}, ${lon}]:`, err.message);
          return {
            status: 'failed_upstream',
            dataMode: 'unavailable',
            freshness: 'unavailable',
            data: null
          };
        }),

      // Terrain features
      getTerrainFeaturesForLocation(lat, lon)
        .catch(err => {
          console.error(`Terrain fetch failed for [${lat}, ${lon}]:`, err.message);
          return { elevation: null, slope: null, source: 'unavailable' };
        }),

      // Historical Landslide Events (50km radius via 2dsphere)
      LandslideEvent.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates },
            $maxDistance: SEARCH_RADIUS_METERS
          }
        }
      })
      .limit(20)
      .lean()
      .catch(err => {
        console.error('Nearby events query error:', err.message);
        return [];
      }),

      // Field Reports (50km radius via 2dsphere)
      FieldReport.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates },
            $maxDistance: SEARCH_RADIUS_METERS
          }
        }
      })
      .select('-userId')
      .limit(10)
      .lean()
      .catch(err => {
        console.error('Nearby field reports query error:', err.message);
        return [];
      }),

      // Infrastructure Assets (50km radius via 2dsphere)
      InfrastructureAsset.find({
        locationPoint: {
          $near: {
            $geometry: { type: 'Point', coordinates },
            $maxDistance: SEARCH_RADIUS_METERS
          }
        }
      })
      .limit(15)
      .lean()
      .catch(err => {
        console.error('Nearby infrastructure query error:', err.message);
        return [];
      }),

      // Satellite Land Cover (safely isolated)
      satelliteLandCoverService.getLandCover(lat, lon)
        .catch(err => {
          console.error(`Satellite land-cover fetch failed for [${lat}, ${lon}]:`, err.message);
          return { available: false, source: 'satellite_error', error: err.message };
        })
    ]);

    // 2. Format weather object strictly preserving 24h rainfall integrity
    const weatherData = weatherResult.data;
    const weather = {
      status: weatherResult.status,
      dataMode: weatherResult.dataMode,
      freshness: weatherResult.freshness,
      temperature: weatherData?.temperature ?? null,
      humidity: weatherData?.humidity ?? null,
      windSpeed: weatherData?.windSpeed ?? null,
      precipitationProbability: weatherData?.precipitationProbability ?? null,
      rainfall24h: weatherData?.rainfall24h ?? weatherData?.precipitation24h ?? null,
      currentIntervalPrecipitation: weatherData?.currentIntervalPrecipitation ?? weatherData?.precipitation ?? null,
      dailyForecast: weatherData?.dailyForecast ?? null,
      recordedAt: weatherData?.recordedAt ? new Date(weatherData.recordedAt).toISOString() : null
    };

    // 3. Format soil moisture
    const soilData = soilMoistureSync.data;
    const soilMoisture = {
      status: soilMoistureSync.status,
      dataMode: soilMoistureSync.dataMode,
      freshness: soilMoistureSync.freshness,
      soilMoisture: soilData ? (soilData.soilMoisture ?? null) : null,
      recordedAt: soilData ? (soilData.recordedAt ? new Date(soilData.recordedAt).toISOString() : null) : null
    };

    // 4. Enrich spatial queries with geodesic distance (in km)
    const enrichedEvents = nearbyEvents.map(event => {
      const distanceKm = event.location?.latitude != null && event.location?.longitude != null
        ? calculateDistanceKm(lat, lon, event.location.latitude, event.location.longitude)
        : null;
      return {
        ...event,
        distanceKm
      };
    });

    const enrichedFieldReports = nearbyReports.map(report => {
      const distanceKm = report.location?.latitude != null && report.location?.longitude != null
        ? calculateDistanceKm(lat, lon, report.location.latitude, report.location.longitude)
        : null;
      return {
        ...report,
        distanceKm
      };
    });

    // 5. Enrich infrastructure with distance and operational priorities
    let hazardContext = 'none';
    if (weather.rainfall24h != null && soilMoisture.soilMoisture != null) {
      const envBaseline = calculateRiskScore({
        rainfall: weather.rainfall24h,
        soilMoisture: soilMoisture.soilMoisture
      });
      if (envBaseline?.level) {
        hazardContext = envBaseline.level;
      }
    }

    const enrichedInfrastructure = nearbyAssets.map(asset => {
      const distanceKm = asset.location?.latitude != null && asset.location?.longitude != null
        ? calculateDistanceKm(lat, lon, asset.location.latitude, asset.location.longitude)
        : null;
      const priority = calculateOperationalPriority({
        importance: asset.importance,
        populationServed: asset.populationServed,
        alternativeAvailable: asset.alternativeAvailable,
        status: asset.status,
        hazardContext
      });
      return {
        ...asset,
        distanceKm,
        operationalPriority: priority
      };
    });

    // Sort infrastructure by priority score descending
    enrichedInfrastructure.sort((a, b) => {
      const scoreA = a.operationalPriority?.status === 'calculated' && typeof a.operationalPriority.score === 'number'
        ? a.operationalPriority.score : -1;
      const scoreB = b.operationalPriority?.status === 'calculated' && typeof b.operationalPriority.score === 'number'
        ? b.operationalPriority.score : -1;
      return scoreB - scoreA;
    });

    // 6. ML Risk Prediction from trained production models
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

    // 7. Evidence Fusion
    const rainfallObs = weatherData ? [{
      rainfall: weather.rainfall24h ?? weather.currentIntervalPrecipitation ?? 0,
      rainfall24h: weather.rainfall24h,
      currentIntervalPrecipitation: weather.currentIntervalPrecipitation,
      recordedAt: weatherData.recordedAt,
      isStale: false
    }] : [];

    const soilObs = soilData ? [{
      soilMoisture: soilMoisture.soilMoisture,
      recordedAt: soilData.recordedAt,
      isStale: false
    }] : [];

    const fusionResult = fuseEvidence({
      location: { latitude: lat, longitude: lon },
      terrain: terrainFeatures,
      rainfallObservations: rainfallObs,
      soilMoistureObservations: soilObs,
      historicalEvents: enrichedEvents,
      fieldReports: enrichedFieldReports,
      mlPrediction,
      satellite: satelliteLandCover,
      referenceTime: now
    });

    // 8. Separate active incidents (non-historical) from historical catalog events
    const activeIncidents = enrichedEvents.filter(e => !e.isHistorical);
    const historicalLandslides = enrichedEvents.filter(e => e.isHistorical || e.isHistorical === undefined);

    const responsePayload = {
      selectedLocation: { latitude: lat, longitude: lon },
      searchRadiusMeters: SEARCH_RADIUS_METERS,
      weather,
      soilMoisture,
      terrain: terrainFeatures,
      satellite: satelliteLandCover,
      incidentHistory: {
        totalCount: historicalLandslides.length,
        events: historicalLandslides,
        nearestDistanceKm: historicalLandslides.length > 0 && typeof historicalLandslides[0].distanceKm === 'number'
          ? historicalLandslides[0].distanceKm : null
      },
      fieldReports: {
        totalCount: enrichedFieldReports.length,
        reports: enrichedFieldReports
      },
      infrastructure: {
        totalCount: enrichedInfrastructure.length,
        assets: enrichedInfrastructure,
        criticalCount: enrichedInfrastructure.filter(a => a.status === 'closed' || a.importance >= 4).length
      },
      activeIncidents: {
        totalCount: activeIncidents.length,
        incidents: activeIncidents
      },
      aiRiskAnalysis: {
        riskLevel: fusionResult.riskLevel || 'Unavailable',
        riskScore: typeof fusionResult.riskScore === 'number' ? fusionResult.riskScore : null,
        confidence: mlPrediction?.status === 'success' && mlPrediction?.prediction?.probability != null
          ? Math.round(mlPrediction.prediction.probability * 100) : null,
        mlStatus: mlPrediction?.status || 'unavailable',
        reasoning: fusionResult.reasoning || [],
        limitations: fusionResult.limitations || []
      },
      evidenceFusion: fusionResult,
      mlPrediction,
      retrievedAt: now.toISOString()
    };

    res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Dashboard Intelligence Error:', error);
    res.status(500).json({ error: 'An unexpected server error occurred while retrieving dashboard intelligence.' });
  }
};

module.exports = {
  getDashboardIntelligence
};
