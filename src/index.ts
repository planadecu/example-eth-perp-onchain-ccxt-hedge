import * as dotenv from 'dotenv'
import { ethers, WebSocketProvider, Contract, ContractEventName } from 'ethers'
import * as ccxt from 'ccxt'


// Read environment variables from .env file

dotenv.config()

const ethereumWSClient = process.env.ETHEREUM_WS_CLIENT!
const uniswapV2RouterAddress = process.env.CONTRACT_ADDRESS!
const wstEthAddress = process.env.WSTETH_ADDRESS!
const usdcAddress = process.env.USDC_ADDRESS!

// Read contract abis
const uniswapV2RouterABI = require('../abis/UniswapV2Router.json').abi

// PART 1: Read a smart contract state
async function main() {
  const provider = new WebSocketProvider(ethereumWSClient);
  const uniswapV2RouterContract = new Contract(uniswapV2RouterAddress, uniswapV2RouterABI, provider)

  let oldState = 0
  provider.on('block', async (blockNumber) => {
    console.log('Block number: ' + blockNumber)
    const state = await uniswapV2RouterContract.getAmountOut(100000, wstEthAddress, usdcAddress);

    // Has state changed?
    if (oldState !== state) {
      await getTopOfTheBookDepth();

    }

    // Update state
    oldState = state
  })
}

// PART 2 & 3: Fetch the top of book depth for all ETH denominated perpetual contracts both USD margined and COIN margined (express this as order size to impact price by 50bps) using CCXT package
async function getTopOfTheBookDepth() {

  const exchanges = [
    new ccxt.binancecoinm({ 
      enableRateLimit: true
    }), 
    new ccxt.binance({ 
      enableRateLimit: true
    }),
    new ccxt.binanceusdm({ 
      enableRateLimit: true
    }), 
    new ccxt.okx({ 
      enableRateLimit: true
    }),
    new ccxt.bybit({ 
      enableRateLimit: true
    }),
    new ccxt.deribit({ 
      enableRateLimit: true
    })
  ]

  exchanges.forEach(async (exchange) => {
    
    exchange.markets = await exchange.loadMarkets(true)
    for (let symbol in exchange.markets) {
      const market = exchange.markets[symbol];
      const base = ["ETH", "WETH"]
      const quote = ["USD", "USDT", "USDC"]

      // Filter out all perpetual contracts between ETH and USD
      if ( base.includes(market.base) && quote.includes(market.quote) && market.contract == true && market.swap == true ) {

        try {
          const orderBook = await exchange.fetchOrderBook(symbol)
          
          console.log(symbol, '(' + exchange.name + ')')
          if(orderBook.bids && orderBook.bids.length > 0 && orderBook.asks && orderBook.asks.length > 0) {
            
            // calculate bid depth
            const bidMinPrice = orderBook.bids[0][0] - (orderBook.bids[0][0] * 0.005)
            const bidDepth = orderBook.bids.reduce((total, bid) => total + ( bid[1] > bidMinPrice ? bid[1] : 0), 0)
            console.log(' - Bid min price: ', bidMinPrice, 'Units:', bidDepth)

            // calculate ask depth
            const askMaxPrice = orderBook.asks[0][0] + (orderBook.asks[0][0] * 0.005)
            const askDepth = orderBook.asks.reduce((total, ask) => total + ( ask[1] < askMaxPrice ? ask[1] : 0), 0)
            console.log(' - Ask max price: ', askMaxPrice, 'Units:', askDepth)
            
          } else {
            console.log(' - No bids or asks')
          } 

          // Wait for rate limit
          await (ccxt as any).sleep(exchange.rateLimit); // Missing type information.
        } catch (error) {
          console.log('Error:', error);
        }
      }
    }
  })

  console.log('State changed')
}


main().catch(e => {
  console.error(e)
});