const openMeteoProvider = require('./openMeteoProvider');

class WeatherProviderFactory {
  static getProvider(providerName) {
    switch (providerName) {
      case 'open-meteo':
        return openMeteoProvider;
      default:
        // Default to Open-Meteo
        return openMeteoProvider;
    }
  }
}

module.exports = WeatherProviderFactory;
