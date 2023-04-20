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
      console.log('State changed')

      console.log(await getFutureExchangeInfo())

      console.log('Done')
    }

    // Update state
    oldState = state
  })
}


// PART 2 & 3: Fetch the top of book depth for all ETH denominated perpetual contracts both USD margined and COIN margined (express this as order size to impact price by 50bps) using CCXT package
type FutureExchangeInfo = {
  symbol: string,
  bidDepth: number,
  askDepth: number,
  fundingRate: number
}

async function getFutureExchangeInfo(): Promise<FutureExchangeInfo[]> {

  const promises: Promise<FutureExchangeInfo>[] = []

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

  await Promise.all(exchanges.map(async (exchange) => (new Promise<void>(async (resolve) => {
    try {
      exchange.markets = await exchange.loadMarkets(true)
      for (let symbol in exchange.markets) {
        const market = exchange.markets[symbol];
        const base = ["ETH", "WETH"]
        const quote = ["USD", "USDT", "USDC"]

        // Filter out all perpetual contracts between ETH and USD
        if ( base.includes(market.base) && quote.includes(market.quote) && market.contract == true && market.swap == true ) {

          let bidMinPrice = Number.MAX_VALUE, bidDepth = 0, askMaxPrice = Number.MIN_VALUE, askDepth = 0, fundingRate = null

          promises.push(new Promise(async (resolve) => {
            try {
              const orderBook = await exchange.fetchOrderBook(symbol)
              
            
              if(orderBook.bids && orderBook.bids.length > 0 && orderBook.asks && orderBook.asks.length > 0) {
                
                // calculate bid depth
                bidMinPrice = orderBook.bids[0][0] - (orderBook.bids[0][0] * 0.005)
                bidDepth = orderBook.bids.reduce((total, bid) => total + ( bid[1] > bidMinPrice ? bid[1] : 0), 0)

                // calculate ask depth
                askMaxPrice = orderBook.asks[0][0] + (orderBook.asks[0][0] * 0.005)
                askDepth = orderBook.asks.reduce((total, ask) => total + ( ask[1] < askMaxPrice ? ask[1] : 0), 0)
                
              } 

              // Wait for rate limit
              await (ccxt as any).sleep(exchange.rateLimit); // Missing type information.
            } catch (error) {
              console.log('Error: could not fetch orderbook', error);
            }
            
            try {
              // PART 4: Get Funding rate
              fundingRate = (await exchange.fetchFundingRate(symbol)).fundingRate;
              
            } catch (error) {
              fundingRate = NaN
            }

            console.log(symbol, '(' + exchange.name + ')')
            console.log(' - Bid min price: ', bidMinPrice, 'Units:', bidDepth)
            console.log(' - Ask max price: ', askMaxPrice, 'Units:', askDepth)
            console.log(' - Funding rate: ', fundingRate)

            resolve({
              symbol,
              bidDepth,
              askDepth,
              fundingRate
            })
          }))

        }
      }
    } catch (error) {
      console.log('Error: could not load markets', error);
    }
    resolve()
  }))))

  return Promise.all(promises)
}


main().catch(e => {
  console.error(e)
})

