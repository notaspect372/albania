const puppeteerExtra = require('puppeteer-extra');
const fs = require('fs');
const xlsx = require('xlsx');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getLatLongFromAddress(address) {
    const { default: fetch } = await import('node-fetch'); // Dynamically import node-fetch
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;

    try {
        // Fetch the geocoding data
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MyGeocoderApp/1.0; +http://mywebsite.com)'
            }
        });
        const data = await response.json();

        if (data && data.length > 0) {
            const { lat, lon } = data[0];
            console.log(`Latitude: ${lat}, Longitude: ${lon}`);
            return { latitude: lat, longitude: lon };
        } else {
            console.log('No results found for the address.');
            return { latitude: 'N/A', longitude: 'N/A' };
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        return { latitude: 'N/A', longitude: 'N/A' };
    }
}


// Base URLs to scrape
const baseUrls = [
    "https://www.merrjep.al/njoftime/imobiliare-vendbanime/cimer-cimere/me-qera"
    // Add more URLs here
];

// Function to scrape property URLs from a specific page
async function scrapePropertyUrls(page, paginatedUrl) {
    try {
        await page.goto(paginatedUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        const propertyUrls = await page.$$eval('a.span2-ad-img-list', links => {
            return links.map(link => link.href);
        });
        return propertyUrls;
    } catch (error) {
        console.error(`Error scraping property URLs on page: ${paginatedUrl}`, error);
        return [];
    }
}

// Function to scrape data from a specific property page
async function scrapePropertyData(page, propertyUrl) {
    await delay(2000); // Wait for 2 seconds before navigating to the next page
    try {
        await page.goto(propertyUrl, { waitUntil: 'networkidle2', timeout: 0 });

        const name = await page.$eval('meta[property="og:title"]', el => el.content).catch(() => 'N/A');
        const description = await page.$eval('div.description-area span', el => el.textContent.trim()).catch(() => 'N/A');
        let address = await page.$eval('span.display-ad-address', el => el.textContent.trim()).catch(() => 'N/A');
        
        // Fallback to 'tags-area' div if main address field is not found
        if (address === 'N/A') {
            address = await page.$$eval('div.tags-area a.tag-item', elements => {
                const adresaElement = elements.find(el => el.querySelector('span')?.textContent.includes('Adresa/Rruga:'));
                return adresaElement ? adresaElement.querySelector('bdi').textContent.trim() : 'N/A';
            }).catch(() => 'N/A');
        }        const price = await page.$eval('bdi.new-price', el => el.textContent.trim()).catch(() => 'N/A');

        // Scrape characteristics
        const characteristics = {};
        const characteristicsElements = await page.$$('div.tags-area a.tag-item');
        for (let element of characteristicsElements) {
            const key = await element.$eval('span', el => el.textContent.trim());
            const value = await element.$eval('bdi', el => el.textContent.trim());
            characteristics[key] = value;
        }

        // Flatten characteristics
        let flatCharacteristics = '';
        for (const [key, value] of Object.entries(characteristics)) {
            flatCharacteristics += `${key}: ${value}, `;
        }
        flatCharacteristics = flatCharacteristics.slice(0, -2); // Remove trailing comma and space

        // Scrape property type from breadcrumbs
        const propertyType = await page.$$eval('ul.breadcrumbs li', items => items[3] ? items[3].textContent.trim() : 'N/A');
        const transactionType = characteristics['Lloji i njoftimit:'] || 'N/A';
        const area = characteristics['Sipërfaqe:'] || 'N/A';



        

        // Get latitude and longitude based on address locality using getLatLongFromAddress function
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(address)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        await delay(5000); // Allow time for Google Maps to load
    
        let latitude = 'N/A', longitude = 'N/A';
        const currentUrl = page.url();
        const urlMatch = currentUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (urlMatch) {
            latitude = urlMatch[1];
            longitude = urlMatch[2];
            console.log(`Latitude: ${latitude}, Longitude: ${longitude}`);
        } else {
            console.log('Google Maps could not find latitude and longitude. Falling back to Nominatim.');
            const fallbackCoordinates = await getLatLongFromAddress(address);
            latitude = fallbackCoordinates.latitude;
            longitude = fallbackCoordinates.longitude;
        }


        return {
            URL: propertyUrl,
            Name: name,
            Description: description,
            Address: address,
            Price: price,
            Area: area,
            Characteristics: flatCharacteristics,  // Include the flattened characteristics
            PropertyType: propertyType,
            TransactionType: transactionType,
            Latitude: latitude,
            Longitude: longitude
        };
    } catch (error) {
        console.error(`Error scraping property data on URL: ${propertyUrl}`, error);
        return null;
    }
}
// Main function to scrape data
(async () => {
  const browser = await puppeteerExtra.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null,
});

    const page = await browser.newPage();

    for (let baseUrl of baseUrls) {
        console.log(`Scraping data from base URL: ${baseUrl}`);

        const allPropertyUrls = new Set();
        let pageNum = 1;
        let foundDuplicate = false;

        // Scrape property URLs incrementally, stop if a duplicate is found
        while (!foundDuplicate) {
            const paginatedUrl = `${baseUrl}?Page=${pageNum}`;
            console.log(`Scraping page ${pageNum}: ${paginatedUrl}`);
            const pageUrls = await scrapePropertyUrls(page, paginatedUrl);

            for (let url of pageUrls) {
                if (allPropertyUrls.has(url)) {
                    foundDuplicate = true;
                    break;
                }
                allPropertyUrls.add(url);
            }
            if (!foundDuplicate) pageNum++;
        }

        console.log(`Total unique property URLs found: ${allPropertyUrls.size}`);

        const scrapedData = [];


        // Scrape data from each property URL
        for (let propertyUrl of allPropertyUrls) {
            console.log(`Scraping property: ${propertyUrl}`);
            const propertyData = await scrapePropertyData(page, propertyUrl);
            console.log(propertyData)
            if (propertyData) {
                console.log(propertyData)
                scrapedData.push(propertyData);

            }
        }

        // Save the data to an Excel file
 if (!fs.existsSync('output')) {
            fs.mkdirSync('output');
        }

        const outputDirectory = 'output/';
        const baseFilename = baseUrl.replace("https://", "").replace(/\//g, "_") + ".xlsx";
        const filePath = outputDirectory + baseFilename;
        const wb = xlsx.utils.book_new();
        const ws = xlsx.utils.json_to_sheet(scrapedData);
        xlsx.utils.book_append_sheet(wb, ws, "Properties");
        xlsx.writeFile(wb, filePath);

        if (fs.existsSync(filePath)) {
            console.log(`File successfully created at ${filePath}`);
        } else {
            console.error(`Failed to create file at ${filePath}`);
        }
    }


    await browser.close();
})();
