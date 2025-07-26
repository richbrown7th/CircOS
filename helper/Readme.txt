#Readme

npm install



Notes to test manually

curl -X POST http://localhost:8800/cache \
  -H "Content-Type: application/json" \
  -d '{
    "address": "192.168.1.101",
    "name": "Manual Machine A",
    "port": 9000
  }'