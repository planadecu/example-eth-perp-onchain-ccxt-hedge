import * as dotenv from 'dotenv'
import { WebSocketProvider, Contract } from 'ethers'
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
      console.log('State changed from smart contract')

      const futureExchangeInfo = await getFutureExchangeInfo()

      // futureExchangeInfo.forEach(pair => {
      //   console.log(pair.symbol, '(' + pair.exchange + ')')
      //   console.log(' - Bid depth:', pair.bidDepth)
      //   console.log(' - Ask depth:', pair.askDepth)
      //   console.log(' - Funding rate:', pair.fundingRate)
      // });

      // Getting optimal trade for 100ETH assuming will be holding a short position for 2 days with a stable funding rate
      const amount = 100
      const info = getOptimalExchange(amount, 'short', 2, futureExchangeInfo!)
      // print trade info
      console.log('Optimal trade:', info.pair.symbol, '(' + info.pair.exchange + ')')
      console.log(' - Taker Fee:', info.pair.takerFee)
      console.log(' - Funding rate:', info.pair.fundingRate)
      console.log(' - Total Cost:', info.price)
      console.log(' - Set limit order:', info.limitOrder)

      // PART 6: Post write instruction to onchain address to send 100 of ETH
      console.log('Sending transaction to the smart contract')
      try {
        const tx = await uniswapV2RouterContract.swapETHForExactTokens(100, wstEthAddress, usdcAddress, info.price)
        // Wait for transaction to be mined
        console.log('Waiting for transaction to be mined...')
        if(tx) await provider.waitForTransaction(tx.txHash)
        console.log('Transaction mined')

        // PART 7: Post order on exchange(s) to execute hedge
        try {
          const order = await exchanges.find(exchange => exchange.id == info.pair.exchange)?.createOrder(info.pair.symbol, 'limit', 'sell', amount, info.limitOrder, { 'timeInForce': 'GTC' })
          console.log('Order created:', order)
        } catch (error) {
          console.log('Error: could not create order')
        }

      } catch (error) {
        console.log('TX failed: not enough gas to send transaction')
      }

      console.log('Done')
    }

    // Update state
    oldState = state
  })
}


// PART 2 & 3: Fetch the top of book depth for all ETH denominated perpetual contracts both USD margined and COIN margined (express this as order size to impact price by 50bps) using CCXT package
type FutureExchangeInfo = {
  exchange: string,
  symbol: string,
  bidDepth: number,
  askDepth: number,
  fundingRate: number,
  orderBook: ccxt.OrderBook | null
  takerFee: number | undefined
}

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

async function getFutureExchangeInfo(): Promise<FutureExchangeInfo[]> {

  const promises: Promise<FutureExchangeInfo>[] = []

  await Promise.all(exchanges.map(async (exchange) => (new Promise<void>(async (resolve) => {
    try {
      const markets = await exchange.loadMarkets(true)
      for (let symbol in markets) {
        const market = markets[symbol];
        
        const base = ["ETH"]
        const quote = ["USD", "USDT", "USDC"]

        // Filter out all perpetual contracts between ETH and USD
        if ( base.includes(market.base) && quote.includes(market.quote) && market.contract == true && market.swap == true ) {

          let bidMinPrice = Number.MAX_VALUE, bidDepth = 0, askMaxPrice = Number.MIN_VALUE, askDepth = 0, fundingRate = null

          promises.push(new Promise(async (resolve) => {
            let orderBook = null
            try {
              orderBook = await exchange.fetchOrderBook(symbol)
              
            
              if(orderBook.bids && orderBook.bids.length > 0 && orderBook.asks && orderBook.asks.length > 0) {
                
                // calculate bid depth
                bidMinPrice = orderBook.bids[0][0] - (orderBook.bids[0][0] * 0.005)
                bidDepth = orderBook.bids.reduce((total, bid) => total + ( bid[0] > bidMinPrice ? bid[1] : 0), 0)

                // calculate ask depth
                askMaxPrice = orderBook.asks[0][0] + (orderBook.asks[0][0] * 0.005)
                askDepth = orderBook.asks.reduce((total, ask) => total + ( ask[0] < askMaxPrice ? ask[1] : 0), 0)
                
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

            resolve({
              exchange: exchange.name,
              symbol,
              bidDepth,
              askDepth,
              fundingRate,
              orderBook,
              takerFee: market.taker
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

// PART 5: Create logic to decide where to deploy collateral to optimize for: order execution [fees, orderbook impact, funding rate, other]
function getOptimalExchange(amount: number, direction: 'short' | 'long', hodlDaysForecast: number, exchangeInfo: FutureExchangeInfo[]): {price: number, limitOrder: number, pair: FutureExchangeInfo} {
  return exchangeInfo.map(pair => { 
      // calculate the filled price ofthe amount in USD from the orderbook
      let price = Number.MAX_VALUE
      const filledPrice = pair.orderBook!.asks.reduce(([price, limitOrder, paid], ask) => {
        if (paid < amount) {
          if(ask[1] > amount-paid) {
            return [price + (amount-paid) * ask[0], ask[0], amount]
          } else {
            return [price + ask[1] * ask[0], ask[0], paid + ask[1]]
          }
        } else {
          return [price, limitOrder, paid]
        }
      }, [0, 0, 0])
      
      if(filledPrice[2] < amount) {
        console.log('Not enough liquidity for', amount, 'ETH ->', pair.symbol, '(' + pair.exchange + ')')
      } else {
        price = filledPrice[0]
      }

      // add fees
      if (pair.takerFee === undefined || Number.isNaN(pair.takerFee)) {
        console.log('Taker fee not defined for', pair.symbol, '(' + pair.exchange + ')')
      } else {
        price *= 1 + hodlDaysForecast * 3 *( direction==='long'? pair.takerFee : -pair.takerFee)
      }

      // add funding rate for the next 8 hours
      if (pair.fundingRate === undefined || Number.isNaN(pair.fundingRate)) {
        console.log('Funding rate not available for', pair.symbol, '(' + pair.exchange + ') -> assuming 0')
      } else {
        price *= 1 + pair.fundingRate
      } 

      return {price, limitOrder: filledPrice[1], pair}
  }).sort((a, b) => a.price - b.price)[0]
}

main().catch(e => {
  console.error(e)
})
