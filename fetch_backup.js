const url = 'https://wonshabdlvjzdtiicsjf.supabase.co/rest/v1/lessons?select=*&order=id';
const apiKey = 'sb_publishable_KkLWWWQJ3Nc4SCJ_GI22Tw_zagGImcV';

fetch(url, {
    method: 'GET',
    headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    }
})
    .then(res => res.json())
    .then(data => {
        const fs = require('fs');
        fs.writeFileSync('words.json', JSON.stringify(data, null, 2));
        console.log('Backed up ' + data.length + ' lessons.');
    })
    .catch(err => console.error(err));
