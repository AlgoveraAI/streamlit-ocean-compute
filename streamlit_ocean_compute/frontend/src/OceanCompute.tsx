

import {
    Streamlit,
    StreamlitComponentBase,
    withStreamlitConnection,
} from "streamlit-component-lib"
import React, { ReactNode } from "react"

import { Decimal } from 'decimal.js'
import { Client, gql, OperationContext, OperationResult, TypedDocumentNode, createClient } from "urql"
import Web3  from "web3"

import {
  amountToUnits,
  approveWei,
  Aquarius,
  Asset,
  balance,
  ComputeOutput,
  ConfigHelper,
  ConsumeMarketFee,
  Datatoken,
  FixedRateExchange,
  FreOrderParams,
  LoggerInstance,
  OrderParams,
  ProviderComputeInitialize,
  ProviderFees,
  ProviderInstance,
 } from "@oceanprotocol/lib"
import assert from "assert"

interface State {
    computeJobId: any
    isFocused: boolean
}
  
declare global {
    interface Window {
      ethereum: any;
    }
}

declare global {
  interface AssetExtended extends Asset {
    accessDetails?: any
  }
}


// default variables used throughout the script
const web3 = new Web3(window.ethereum)
const datatoken = new Datatoken(web3)

const tokenPriceQuery = gql`
  query TokenPriceQuery($datatokenId: ID!, $account: String) {
    token(id: $datatokenId) {
      id
      symbol
      name
      publishMarketFeeAddress
      publishMarketFeeToken
      publishMarketFeeAmount
      orders(
        where: { payer: $account }
        orderBy: createdTimestamp
        orderDirection: desc
      ) {
        tx
        serviceIndex
        createdTimestamp
        reuses(orderBy: createdTimestamp, orderDirection: desc) {
          id
          caller
          createdTimestamp
          tx
          block
        }
      }
      dispensers {
        id
        active
        isMinter
        maxBalance
        token {
          id
          name
          symbol
        }
      }
      fixedRateExchanges {
        id
        exchangeId
        price
        publishMarketSwapFee
        baseToken {
          symbol
          name
          address
          decimals
        }
        datatoken {
          symbol
          name
          address
        }
        active
      }
    }
  }
`


/**
   * @interface AccessDetails
   * @prop {'fixed' | 'free' | 'NOT_SUPPORTED'}  type
   * @prop {string} price can be either spotPrice/rate
   * @prop {string} addressOrId for fixed/free this is an id.
   * @prop {TokenInfo} baseToken
   * @prop {TokenInfo} datatoken
   * @prop {bool} isPurchasable checks if you can buy a datatoken from fixed rate exchange/dispenser.
   * @prop {bool} isOwned checks if there are valid orders for this, it also takes in consideration timeout
   * @prop {string} validOrderTx  the latest valid order tx, it also takes in consideration timeout
   * @prop {string} publisherMarketOrderFee this is here just because it's more efficient, it's allready in the query
   * @prop {FeeInfo} feeInfo  values of the relevant fees
   */
 interface AccessDetails {
  type: 'fixed' | 'free' | 'NOT_SUPPORTED'
  price: string
  addressOrId: string
  baseToken: any
  datatoken: any
  isPurchasable?: boolean
  isOwned: boolean
  validOrderTx: string
  publisherMarketOrderFee: string
}

/**
   * @interface OrderPriceAndFee
   * @prop {string}  price total price including fees
   * @prop {string}  publisherMarketOrderFee fee received by the market where the asset was published. It is set on erc20 creation. It is a absolute value
   * @prop {string}  publisherMarketFixedSwapFee fee received by the market where the asset was published on any swap (fre). Absolute value based on the configured percentage
   * @prop {string}  consumeMarketOrderFee fee received by the market where the asset is ordered. It is set on erc20 creation. It is a absolute value
   * @prop {string}  consumeMarketFixedSwapFee fee received by the market where the asset is ordered on any swap (fre). Absolute value based on the configured percentage
   * @prop {ProviderFees} providerFee received from provider
   * @prop {string}  opcFee ocean protocol community fee, Absolute value based on the configured percentage
   */
 interface OrderPriceAndFees {
  price: string
  publisherMarketOrderFee: string
  publisherMarketFixedSwapFee: string
  consumeMarketOrderFee: string
  consumeMarketFixedSwapFee: string
  providerFee: ProviderFees
  opcFee: string
}

// helper functions
const getTestConfig = async (web3: Web3) => {
  const config = new ConfigHelper().getConfig(await web3.eth.getChainId())
  config.providerUri = process.env.PROVIDER_URL || config.providerUri
  return config
}
let urqlClient: Client

function getUrqlClientInstance(): Client {
  return urqlClient
}


async function fetchData(
  query: TypedDocumentNode,
  variables: any,
  context: OperationContext
): Promise<any> {
  try {
    console.log("Fetching data, query is ", query)
    // const client = getUrqlClientInstance()
    console.log("Context url is ", context.url)
    const client = createClient({ url: context.url })
    console.log("Intialized client is ", client)

    const response = await client.query(query, variables, context).toPromise()
    console.log("Response is ", response)
    return response
  } catch (error: any) {
    LoggerInstance.error('Error fetchData: ', error.message)
  }
  return null
}

async function getQueryContext(chainId: number) {
  try {
    const config: any = await getTestConfig(web3)
    const subgraphUri = config.subgraphUri
    const queryContext: OperationContext = {
      url: `${subgraphUri}/subgraphs/name/oceanprotocol/ocean-subgraph`,
      requestPolicy: 'network-only'
    }
    console.log("Query context is ", queryContext)
    return queryContext
  } catch (error: any) {
    LoggerInstance.error('Get query context error: ', error.message)
  }
}

async function getFixedBuyPrice(accessDetails: any, chainId: any) {
  let config: any = await getTestConfig(web3)
  const fixed: any = new FixedRateExchange(config.fixedRateExchangeAddress, web3)
  const estimatedPrice = await fixed.calcBaseInGivenOutDT(
    accessDetails.addressOrId,
    '1',
    process.env.NEXT_PUBLIC_CONSUME_MARKET_FIXED_SWAP_FEE || '0'
  )
  return estimatedPrice
}

function getAccessDetailsFromTokenPrice(
  tokenPrice: any,
  timeout?: any
): AccessDetails {
  const accessDetails = {} as AccessDetails

  // Return early when no supported pricing schema found.
  if (
    tokenPrice?.dispensers?.length === 0 &&
    tokenPrice?.fixedRateExchanges?.length === 0
  ) {
    accessDetails.type = 'free' // 'NOT_SUPPORTED'
    console.log('No supported pricing schema found.')
    return accessDetails
  }

  if (tokenPrice?.orders?.length > 0) {
    const order = tokenPrice.orders[0]
    const reusedOrder = order?.reuses?.length > 0 ? order.reuses[0] : null
    // asset is owned if there is an order and asset has timeout 0 (forever) or if the condition is valid
    accessDetails.isOwned =
      timeout === 0 || Date.now() / 1000 - order?.createdTimestamp < timeout
    // the last valid order should be the last reuse order tx id if there is one
    accessDetails.validOrderTx = reusedOrder?.tx || order?.tx
  }

  // TODO: fetch order fee from sub query
  accessDetails.publisherMarketOrderFee = tokenPrice?.publishMarketFeeAmount

  // free is always the best price
  if (tokenPrice?.dispensers?.length > 0) {
    const dispenser = tokenPrice.dispensers[0]
    accessDetails.type = 'free'
    accessDetails.addressOrId = dispenser.token.id
    accessDetails.price = '0'
    accessDetails.isPurchasable = dispenser.active
    accessDetails.datatoken = {
      address: dispenser.token.id,
      name: dispenser.token.name,
      symbol: dispenser.token.symbol
    }
  }

  // checking for fixed price
  if (tokenPrice?.fixedRateExchanges?.length > 0) {
    const fixed = tokenPrice.fixedRateExchanges[0]
    accessDetails.type = 'fixed'
    accessDetails.addressOrId = fixed.exchangeId
    accessDetails.price = fixed.price
    // in theory we should check dt balance here, we can skip this because in the market we always create fre with minting capabilities.
    accessDetails.isPurchasable = fixed.active
    accessDetails.baseToken = {
      address: fixed.baseToken.address,
      name: fixed.baseToken.name,
      symbol: fixed.baseToken.symbol,
      decimals: fixed.baseToken.decimals
    }
    accessDetails.datatoken = {
      address: fixed.datatoken.address,
      name: fixed.datatoken.name,
      symbol: fixed.datatoken.symbol
    }
  }

  return accessDetails
}


/**
 * This will be used to get price including fees before ordering
 * @param {AssetExtended} asset
 * @return {Promise<OrdePriceAndFee>}
 */
export async function getOrderPriceAndFees(
  asset: AssetExtended,
  accountId: any, // previously accountId?
  providerFees?: ProviderFees
): Promise<OrderPriceAndFees> {
  const orderPriceAndFee = {
    price: '0',
    publisherMarketOrderFee: process.env.NEXT_PUBLIC_PUBLISHER_MARKET_ORDER_FEE || '0',
    publisherMarketFixedSwapFee: '0',
    consumeMarketOrderFee: process.env.NEXT_PUBLIC_CONSUME_MARKET_ORDER_FEE || '0',
    consumeMarketFixedSwapFee: '0',
    providerFee: {
      providerFeeAmount: '0'
    },
    opcFee: '0'
  } as OrderPriceAndFees

  // fetch provider fee
  const initializeData: any =
    !providerFees &&
    (await ProviderInstance.initialize(
      asset?.id,
      asset?.services[0].id,
      0,
      accountId,
      asset?.services[0].serviceEndpoint
    ))
  orderPriceAndFee.providerFee = providerFees || initializeData.providerFee

  // fetch price and swap fees
  if (asset?.accessDetails?.type === 'fixed') {
    const fixed = await getFixedBuyPrice(asset?.accessDetails, asset?.chainId)
    orderPriceAndFee.price = fixed.baseTokenAmount
    orderPriceAndFee.opcFee = fixed.oceanFeeAmount
    orderPriceAndFee.publisherMarketFixedSwapFee = fixed.marketFeeAmount
    orderPriceAndFee.consumeMarketFixedSwapFee = fixed.consumeMarketFeeAmount
  }

  // calculate full price, we assume that all the values are in ocean, otherwise this will be incorrect
  orderPriceAndFee.price = new Decimal(+orderPriceAndFee.price || 0)
    .add(new Decimal(+orderPriceAndFee?.consumeMarketOrderFee || 0))
    .add(new Decimal(+orderPriceAndFee?.publisherMarketOrderFee || 0))
    .toString()

  return orderPriceAndFee
}

/**
 * @param {number} chainId
 * @param {string} datatokenAddress
 * @param {number} timeout timout of the service, this is needed to return order details
 * @param {string} account account that wants to buy, is needed to return order details
 * @returns {Promise<AccessDetails>}
 */
export async function getAccessDetails(
  chainId: number,
  datatokenAddress: string,
  timeout?: number,
  account = ''
): Promise<any> {
  try {
    console.log("Getting AccessDetails")
    const queryContext: any = await getQueryContext(Number(chainId))
    const tokenQueryResult: OperationResult<
      any,
      { datatokenId: string; account: string }
    > = await fetchData(
      tokenPriceQuery,
      {
        datatokenId: datatokenAddress.toLowerCase(),
        account: account?.toLowerCase()
      },
      queryContext
    )

    const tokenPrice: any = tokenQueryResult.data.token
    const accessDetails = getAccessDetailsFromTokenPrice(tokenPrice, timeout)
    return accessDetails
  } catch (error: any) { // previously without "": any"
    LoggerInstance.error('Error getting access details: ', error.message)
  }
}




// core functions for interacting with the Ocean Market
async function handleOrder(
  ddo: Asset & { accessDetails?: AccessDetails },
  order: any,
  datatokenAddress: string,
  payerAccount: string,
  consumerAccount: string,
  serviceIndex: number,
  consumeMarkerFee?: ConsumeMarketFee
) {
  console.log("order provider fee", order.providerFee)
  /* We do have 3 possible situations:
     - have validOrder and no providerFees -> then order is valid, providerFees are valid, just use it in startCompute
     - have validOrder and providerFees -> then order is valid but providerFees are not valid, we need to call reuseOrder and pay only providerFees
     - no validOrder -> we need to call startOrder, to pay 1 DT & providerFees
  */
    const approveProviderFee = async () => {
      console.log("Approving provider fee")
      console.log("provider fee", order.providerFee)
      // Approve provider fees if exists
      if (order.providerFee && order.providerFee.providerFeeAmount) {
        await datatoken.approve(
          order.providerFee.providerFeeToken,
          datatokenAddress,
          order.providerFee.providerFeeAmount,
          payerAccount
        );
        const config = await getTestConfig(web3)

        await approveWei(
          web3,
          config,
          payerAccount,
          order.providerFee.providerFeeToken,
          payerAccount,
          order.providerFee.providerFeeAmount,
          // datatokenAddress,
        )
      }
    };

    // Return if order already valid, pay fees if neccessary
    if (order.validOrder) {
      console.log("Order is already valid.");
      if (!order.providerFee) return order.validOrder;

      await approveProviderFee();

      const tx = await datatoken.reuseOrder(
        datatokenAddress,
        payerAccount,
        order.validOrder,
        order.providerFee // Must be defined because of first IF check
      );
      return tx.transactionHash;
    }
  
    // Check if user already owns the tokens
    const tokenBalance = await balance(web3, datatokenAddress, payerAccount);
    console.log("Datatoken balance", tokenBalance);

  if (Number(tokenBalance) >= 1) {
    console.log("User already owns the tokens, approving provider fee and starting order");
    await approveProviderFee();
    const tx = await datatoken.startOrder(
      datatokenAddress,
      payerAccount,
      consumerAccount,
      serviceIndex,
      order.providerFee,
      consumeMarkerFee
    )
    return tx.transactionHash
  }
  // testing logs
  console.log("ddo", ddo)
  console.log("datatokenAddress", datatokenAddress)
  console.log("payerAccount", payerAccount)
  console.log("consumerAccount", consumerAccount)
  console.log("serviceIndex", serviceIndex)
  console.log("order", order)
  console.log("consumeMarkerFee", consumeMarkerFee)
  // end testing logs
  return await buyAndOrder(
    ddo,
    order,
    datatokenAddress,
    payerAccount,
    consumerAccount,
    serviceIndex,
    approveProviderFee,
    consumeMarkerFee
  );
}

// buyAndOrder datasets, algorithms, compute
const buyAndOrder = async (
  ddo: Asset & { accessDetails?: AccessDetails },
  order: ProviderComputeInitialize,
  datatokenAddress: string,
  payerAccount: string,
  consumerAccount: string,
  serviceIndex: number,
  approveProviderFee: () => Promise<void>,
  consumeMarkerFee?: ConsumeMarketFee
) => {
  if (!order.providerFee)
    throw new Error("Undefined token for paying fees.");

  const orderParams: OrderParams = {
    consumer: consumerAccount,
    serviceIndex: serviceIndex,
    _providerFee: order.providerFee,
    _consumeMarketFee:  { //consumeMarkerFee ??
      consumeMarketFeeAddress: "0x0000000000000000000000000000000000000000",
      consumeMarketFeeToken: order.providerFee.providerFeeToken,
      consumeMarketFeeAmount: "0",
    },
  };
  console.log("ddo.accessDetails", ddo.accessDetails);
  let accessDetails = ddo.accessDetails ?? await getAccessDetails(
    ddo.chainId,
    datatokenAddress,
    3600, // TODO: valid until
    payerAccount,
  );
  console.log("accessDetails", accessDetails);
  accessDetails = {}
  accessDetails.type = 'free'
  // temporary until subgraph works again
  if (accessDetails == undefined ) {
    accessDetails = {}
    accessDetails.type = 'free'
    // accessDetails.type = 'fixed'
    console.log("got here")
  }
  const config: any = await getTestConfig(web3)

  switch (accessDetails?.type) {

    case "fixed": {
      if (!config.fixedRateExchangeAddress)
        throw new Error("Undefined exchange address - unable to purchase data token.");

      const orderPriceAndFees = await getOrderPriceAndFees(ddo, accessDetails, order.providerFee);
      console.log("pricing is fixed")

      // this assumes all fees are in ocean
      await datatoken.approve(
        order.providerFee?.providerFeeToken,
        datatokenAddress,
        await amountToUnits(
          web3,
          order.providerFee?.providerFeeToken ?? "0",
          orderPriceAndFees.price,
          18, // amountToUnits doesn't need web3 if decimals (18) are specified
        ),
        payerAccount
      );

      const freParams: FreOrderParams = {
        exchangeContract: config.fixedRateExchangeAddress,
        exchangeId: accessDetails.addressOrId,
        maxBaseTokenAmount: orderPriceAndFees.price,
        baseTokenAddress: order.providerFee?.providerFeeToken,
        baseTokenDecimals: 18, // TODO: Here we assume 18 decimal token, might not be the case
        swapMarketFee: "0",
        marketFeeAddress: "0x0000000000000000000000000000000000000000",
      };

      const tx = await datatoken.buyFromFreAndOrder(
        datatokenAddress,
        payerAccount,
        orderParams,
        freParams
      );
      return tx.transactionHash;
    }
    case "free": {
      if (!config.dispenserAddress)
        throw new Error("undefined dispenser address - unable to purchase free data token.");

      // Pay provider fee for running alg
      await approveProviderFee();

      const tx = await datatoken.buyFromDispenserAndOrder(
        datatokenAddress,
        payerAccount,
        orderParams,
        config.dispenserAddress
      );
      return tx.transactionHash;
    }
    default: {
      throw new Error("Data with unsupported access type");
    }
  }
};


// main function executed by the button
async function runCompute(dataDid: string, algoDid: string , userAddress: string) {
  const accounts = await window.ethereum.request({
    method: 'eth_requestAccounts',
  });
  console.log("accounts", accounts)
  const payerAccount = accounts[0]

  const config: any = await getTestConfig(web3)
  console.log("config", config)
  const providerUrl = config.providerUri

  const computeEnvs = await ProviderInstance.getComputeEnvironments(providerUrl)
  console.log("Available compute environments", computeEnvs)
  const computeEnv = computeEnvs.find((ce) => ce.priceMin === 0)
  console.log("computeEnv", computeEnv)

  const aquarius = new Aquarius(config.metadataCacheUri)
  console.log("Data DID", dataDid)
  console.log("Algo DID", algoDid)
  const resolvedDdoWith1mTimeout = await aquarius.waitForAqua(dataDid);
  const resolvedAlgoDdoWith1mTimeout = await aquarius.waitForAqua(algoDid);
  console.log("resolvedDataDDO", resolvedDdoWith1mTimeout)
  console.log("resolvedAlgoDDO", resolvedAlgoDdoWith1mTimeout)

  const assets: any[] = [
    {
      documentId: resolvedDdoWith1mTimeout.id,
      serviceId: resolvedDdoWith1mTimeout.services[0].id
    }
  ]
  console.log("assets", assets)
  const dtAddressArray = [resolvedDdoWith1mTimeout.services[0].datatokenAddress]
  console.log("dtAddressArray", dtAddressArray)
  const algo: any = {
    documentId: resolvedAlgoDdoWith1mTimeout.id,
    serviceId: resolvedAlgoDdoWith1mTimeout.services[0].id
  }
  console.log("algo", algo)
  const mytime = new Date()
  const computeMinutes = 20
  console.log("computeMinutes", computeMinutes)
  mytime.setMinutes(mytime.getMinutes() + computeMinutes)
  let computeValidUntil = Math.floor(mytime.getTime() / 1000)
  console.log("computeValidUntil", computeValidUntil)
  if (computeEnv !== undefined) {
  const providerInitializeComputeResults = await ProviderInstance.initializeCompute(
    assets,
    algo,
    computeEnv.id,
    computeValidUntil,
    providerUrl,
    payerAccount
  )
  console.log("providerInitializeComputeResults", providerInitializeComputeResults)
  console.log("Handling order for algorithm")
  algo.transferTxId = await handleOrder(
    resolvedAlgoDdoWith1mTimeout,
    providerInitializeComputeResults.algorithm,
    resolvedAlgoDdoWith1mTimeout.services[0].datatokenAddress,
    payerAccount,
    computeEnv.consumerAddress,
    0
  )

  console.log("algo.transferTxId", algo.transferTxId)

  if (providerInitializeComputeResults.datasets !== undefined) {
  for (let i = 0; i < providerInitializeComputeResults.datasets.length; i++) {
    console.log("Handling order for dataset")
    assets[i].transferTxId = await handleOrder(
      resolvedDdoWith1mTimeout,
      providerInitializeComputeResults.datasets[i],
      dtAddressArray[i],
      payerAccount,
      computeEnv.consumerAddress,
      0
    )
  }
  console.log("About to start compute")
  console.log("Provider URL", providerUrl)
  const output: ComputeOutput = {
    publishAlgorithmLog: true,
    publishOutput: true
  }

  const computeJobs: any = await ProviderInstance.computeStart(
      providerUrl,
      web3,
      payerAccount,
      computeEnv.id,
      assets[0],
      algo,
      // undefined,
      // undefined,
      // output
  )

  console.log("computeJobs", computeJobs)

  const freeEnvDatasetTxId = assets[0].transferTxId
  console.log("freeEnvDatasetTxId", freeEnvDatasetTxId)
  const freeEnvAlgoTxId = algo.transferTxId
  console.log("freeEnvAlgoTxId", freeEnvAlgoTxId)
  const computeJobId = computeJobs[0].jobId

  console.log("computeJobId", computeJobId)
  return [computeJobId, resolvedDdoWith1mTimeout]
  }

  }

}

async function getComputeStatus(computeJobId: any, DATASET_DDO: any) {
  const accounts = await window.ethereum.request({
    method: 'eth_requestAccounts',
  });
  console.log("accounts", accounts)
  const consumerAccount = accounts[0]
  const config: any = await getTestConfig(web3)
  const providerUrl = config.providerUri
  const jobStatus = await ProviderInstance.computeStatus(
    providerUrl,
    consumerAccount,
    computeJobId,
    DATASET_DDO.id
  )
  // assert(jobStatus, 'Cannot retrieve compute status!')
  console.log(jobStatus)

}
    
  /**
   * This is a React-based component template. The `render()` function is called
   * automatically when your component should be re-rendered.
   */
class RunCompute extends StreamlitComponentBase<State> {
  public state = { computeJobId: "No compute job", isFocused: false }

    public render = (): ReactNode => {
      // Arguments that are passed to the plugin in Python are accessible
      // via `this.props.args`. Here, we access the "name" arg.
      // Streamlit sends us a theme object via props that we can use to ensure
      // that our component has visuals that match the active theme in a
      // streamlit app.
      const { theme } = this.props
      const style: React.CSSProperties = {}

      // Maintain compatibility with older versions of Streamlit that don't send
      // a theme object.
      if (theme) {
        // Use the theme object to style our button border. Alternatively, the
        // theme style is defined in CSS vars.
        const borderStyling = `0px solid ${
          this.state.isFocused ? theme.primaryColor : "gray"
        }`
        style.border = borderStyling
        style.outline = borderStyling
        style.backgroundColor = this.props.args["color"] //"#FF4B4B"
        style.color = "white"
        style.borderRadius = "0.2rem"
      }
      const message = this.props.args["message"]
      // Show a button and some text.
      // When the button is clicked, we'll increment our "numClicks" state
      // variable, and send its new value back to Streamlit, where it'll
      // be available to the Python program.
      return (
        <span>
          <button
            style={style}
            onClick={this.onClicked}
            disabled={this.props.disabled}
            onFocus={this._onFocus}
            onBlur={this._onBlur}
          >
            {message}
          </button>
        </span>
      )
    }
  
    /** Click handler for our "Click Me!" button. */
    private onClicked = async (): Promise<void> => {
      if (this.props.args["key"] == "c2d") {
        const transaction: any = await runCompute(this.props.args["data_did"], this.props.args["algo_did"], this.props.args["user_address"])
        this.setState(
          () => ({ computeJobId: transaction }),
          () => Streamlit.setComponentValue(this.state.computeJobId)
        )
      } else if (this.props.args["key"] == "status") {
        if (this.state.computeJobId != "No compute job") {
          const status: any = await getComputeStatus(this.state.computeJobId[0], this.state.computeJobId[1])
        } else {
          const status: any = "You need to start a compute job first"
          console.log("You need to start a compute job first")
        }
      }
      // Increment state.numClicks, and pass the new value back to
      // Streamlit via `Streamlit.setComponentValue`.
    }
  
    /** Focus handler for our "Click Me!" button. */
    private _onFocus = (): void => {
      this.setState({ isFocused: true })
    }
  
    /** Blur handler for our "Click Me!" button. */
    private _onBlur = (): void => {
      this.setState({ isFocused: false })
    }
  }
  
// "withStreamlitConnection" is a wrapper function. It bootstraps the
// connection between your component and the Streamlit app, and handles
// passing arguments from Python -> Component.
//
// You don't need to edit withStreamlitConnection (but you're welcome to!).
export default withStreamlitConnection(RunCompute)
