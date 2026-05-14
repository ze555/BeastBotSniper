import axios from 'axios';
async function test() {
  try {
    const r1 = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr');
    console.log('fapi:', r1.status);
  } catch(e:any) { console.log('fapi err:', e.message, e.response?.status); }
  
  try {
    const r2 = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
    console.log('spot:', r2.status);
  } catch(e:any) { console.log('spot err:', e.message, e.response?.status); }
}
test();
