var GeocoderGeonames = require('geocoder-geonames'),

    geocoder = new GeocoderGeonames({
        username: 'shresthcrimsonbeans'
    });

async function getCountryGeoName(countryName) {

    try {
        let data = await geocoder.get('search', {
            name: countryName,
        })
        // console.log('Country Data:', data.geonames[0]);
        return data.totalResultsCount > 0 ? data.geonames[0] : []
    }
    catch (error) {
        console.error('Error in getCountryGeoName:', error);
        return []
    };
}

// getCountryGeoName('united states')

module.exports = { getCountryGeoName };