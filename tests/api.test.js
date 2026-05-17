const http = require('http');

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/api/status',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 && data.includes('"ok":true')) {
      console.log('✅ API test passed');
      process.exit(0);
    } else {
      console.error(`❌ API test failed: status ${res.statusCode}, body: ${data}`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('❌ Test error:', err.message);
  process.exit(1);
});

req.end();