const fs = require('fs');

const fileContent = fs.readFileSync('c:\\Users\\Admin\\Desktop\\Zoe\\WordApp\\words.js', 'utf8');

// Parse the content carefully
try {
    // 1. the content is just "const WORDS_DATA = [ ... ];"
    let jsonContent = fileContent.trim();
    if (jsonContent.startsWith('const WORDS_DATA = ')) {
        jsonContent = jsonContent.slice('const WORDS_DATA = '.length);
    }
    if (jsonContent.endsWith(';')) {
        jsonContent = jsonContent.slice(0, -1);
    }

    // Try evaluating with Function
    const getWordsData = new Function(`return ${jsonContent};`);
    const WORDS_DATA = getWordsData();

    // 2. Output
    fs.writeFileSync('c:\\Users\\Admin\\Desktop\\Zoe\\WordApp\\words.json', JSON.stringify(WORDS_DATA, null, 2), 'utf8');
    console.log("Successfully extracted WORDS_DATA and saved to words.json");
    console.log("Found", WORDS_DATA.length, "units.");
} catch (e) {
    console.error("There was an error parsing the data:", e.message);
}
