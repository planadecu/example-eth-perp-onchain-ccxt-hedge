import * as dotenv from 'dotenv'
import {ethers, WebSocketProvider, Contract, ContractEventName} from 'ethers'

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
    const uniswapV2RouterContract =  new Contract(uniswapV2RouterAddress, uniswapV2RouterABI, provider)

    let oldState = 0
    provider.on('block', async (blockNumber) => {
        console.log('Block number: ' + blockNumber)
        const state = await uniswapV2RouterContract.getAmountOut(100000, wstEthAddress, usdcAddress );
        

        if(oldState !== state) {
            // State changed
            executeOpearation().catch(e => {
                console.error(e)
            });
        }

        // Update state
        oldState = state
    })
}

// Read and listen to Binance, OKX, ByBit and Deribit API
async function executeOpearation() {
    // Do something
    console.log('State changed')
}

main().catch(e => {
    console.error(e)
});