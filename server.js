const http = require('http');
const https = require('https');

// URL'ы прокси
const DEEPSEEK_URL = process.env.DEEPSEEK_PROXY_URL;
const DEEPSEEK_AUTH = process.env.DEEPSEEK_AUTH_KEY;
const QWEN_URL = process.env.QWEN_PROXY_URL;
const QWEN_AUTH = process.env.QWEN_AUTH_KEY;
const CEREBRAS_KEY = process.env.CEREBRAS_API_KEY;

// Пользователи
const USERS = {
    [process.env.ADMIN_KEY || 'admin-key']: 'Admin',
    [process.env.FRIEND1_KEY || 'friend1-key']: 'Friend 1',
    [process.env.FRIEND2_KEY || 'friend2-key']: 'Friend 2'
};

// Запрос к прокси
function askProxy(url, auth, prompt, systemPrompt) {
    return new Promise((resolve) => {
        const data = JSON.stringify({ prompt: prompt, systemPrompt: systemPrompt || '' });
        const urlObj = new URL(url + '/v1/chat');

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + auth,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 120000
        };

        const protocol = urlObj.protocol === 'https:' ? https : http;
        const req = protocol.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve(json.answer || '[Error]');
                } catch (e) {
                    resolve('[Error]');
                }
            });
        });

        req.on('error', (e) => resolve('[Error: ' + e.message + ']'));
        req.on('timeout', () => { req.destroy(); resolve('[Timeout]'); });
        req.write(data);
        req.end();
    });
}

// Запрос к Cerebras
function askCerebras(prompt) {
    return new Promise((resolve) => {
        const data = JSON.stringify({
            model: 'llama3.3-70b',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 4000,
            temperature: 0.7
        });

        const options = {
            hostname: 'api.cerebras.ai',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + CEREBRAS_KEY,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 60000
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve(json.choices[0].message.content);
                } catch (e) {
                    resolve('[Cerebras Error]');
                }
            });
        });

        req.on('error', () => resolve('[Cerebras Error]'));
        req.on('timeout', () => { req.destroy(); resolve('[Timeout]'); });
        req.write(data);
        req.end();
    });
}

// Режим Coding Team
async function codingTeam(prompt) {
    console.log('💻 Coding Team...');
    
    const qwenCode = await askProxy(QWEN_URL, QWEN_AUTH, prompt, 'You are Qwen Coder Plus. Write clean efficient code.');
    console.log('Qwen done');
    
    const deepseekReview = await askProxy(DEEPSEEK_URL, DEEPSEEK_AUTH,
        'Task: ' + prompt + '\n\nCode:\n' + qwenCode + '\n\nReview and suggest improvements.',
        'You are a code reviewer. Find issues and suggest fixes.');
    console.log('DeepSeek done');
    
    const final = await askCerebras(
        'TASK: ' + prompt + '\n\nCODE:\n' + qwenCode + '\n\nREVIEW:\n' + deepseekReview + '\n\nAs Tech Lead, create the FINAL optimized solution.'
    );
    console.log('Cerebras done');
    
    return { final_answer: final, models: ['qwen-coder-plus', 'deepseek-chat', 'llama3.3-70b'] };
}

// Сервер
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            service: '🧠 DeepCode - NeuroTeam',
            status: 'online',
            team: ['qwen-coder-plus', 'deepseek-chat', 'llama3.3-70b']
        }));
        return;
    }

    if (req.url === '/v1/chat' && req.method === 'POST') {
        const auth = req.headers.authorization || '';
        const key = auth.replace('Bearer ', '');
        if (!USERS[key]) { res.writeHead(401); res.end(JSON.stringify({error:'Unauthorized'})); return; }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const prompt = data.prompt || '';
                console.log('Request from ' + USERS[key] + ': ' + prompt.substring(0, 50) + '...');
                
                const result = await codingTeam(prompt);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, final_answer: result.final_answer, models: result.models }));
            } catch (e) {
                res.writeHead(500); res.end(JSON.stringify({error:e.message}));
            }
        });
        return;
    }

    res.writeHead(404); res.end('Not found');
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('DeepCode on port ' + PORT));
