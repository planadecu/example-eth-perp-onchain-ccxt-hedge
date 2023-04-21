## Goal of the repo
Demonstrate the following concepts: 
1. Listen to a state change from a smart contract adddress [deposit 100 ETH]
2. Read and listen to Binance, OKX, ByBit and Deribit API using CCXT library
3. Fetch the top of book depth for all ETH denominated perpetual contracts both USD margined and COIN margined [express this as order size to impact price by 50bps] 
4. Fetch the current perpetual funding rates across each venue 
5. Create logic to decide where to deploy collateral to optimize for: order execution [fees, orderbook impact, funding cost, other]
6. Post write instruction to onchain address to send 100 of ETH
7. Post order on exchange(s) to execute hedge

## Install Node.js and Package manager

    brew install yarn

## Development

    yarn install
    yarn dev

## Build

    yarn install
    yarn build
    yarn start
