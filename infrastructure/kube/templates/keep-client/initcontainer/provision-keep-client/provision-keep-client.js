const fs = require('fs');
const toml = require('toml');
const tomlify = require('tomlify-j0.4');
const concat = require('concat-stream');
const Web3 = require('web3');
const HDWalletProvider = require("@truffle/hdwallet-provider");

// ETH host info
const ethNetwork = process.env.ETH_NETWORK;
const ethRPCHost = process.env.ETH_HOSTNAME;
const ethRPCPort = process.env.ETH_RPC_PORT;
const ethWSHost = process.env.ETH_WS_HOSTNAME
const ethWSPort = process.env.ETH_WS_PORT;
const ethNetworkId = process.env.ETH_NETWORK_ID;

// Contract owner info
if (process.env.ETH_NETWORK === 'ropsten') {
  const contractOwnerAddress = process.env.CONTRACT_OWNER_ETH_ACCOUNT_ADDRESS;
  const contractOwnerProvider = new HDWalletProvider(process.env.CONTRACT_OWONER_ETH_ACCOUNT_PRIVATE_KEY, process.env.ETH_HOSTNAME);
} else if (process.env.ETH_NETWORK === 'internal')  {
  const contractOwnerAddress = process.env.CONTRACT_OWNER_ETH_ACCOUNT_ADDRESS;
  const contractOwnerProvider = new HDWalletProvider(process.env.CONTRACT_OWONER_ETH_ACCOUNT_PRIVATE_KEY, process.env.ETH_HOSTNAME);
} else {
  console.log('Invalid ETH network selected, please use ropsten or internal.');
  process.exit(1);
}

/*
We override transactionConfirmationBlocks and transactionBlockTimeout because they're
25 and 50 blocks respectively at default.  The result of this on small private testnets
is long wait times for scripts to execute.
*/
const web3_options = {
    defaultBlock: 'latest',
    defaultGas: 4712388,
    transactionBlockTimeout: 25,
    transactionConfirmationBlocks: 3,
    transactionPollingTimeout: 480
};

const web3 = new Web3(contractOwnerProvider, null, web3_options);

/*
Each <contract.json> file is sourced directly from the InitContainer.  Files are generated by
Truffle during contract and copied to the InitContainer image via Circle.
*/

// TokenStaking
const tokenStakingContractJsonFile = '/tmp/TokenStaking.json';
const tokenStakingContractParsed = JSON.parse(fs.readFileSync(tokenStakingContractJsonFile));
const tokenStakingContractAbi = tokenStakingContractParsed.abi;
const tokenStakingContractAddress = tokenStakingContractParsed.networks[ethNetworkId].address;
const tokenStakingContract = new web3.eth.Contract(tokenStakingContractAbi, tokenStakingContractAddress);

// KeepToken
const keepTokenContractJsonFile = '/tmp/KeepToken.json';
const keepTokenContractParsed = JSON.parse(fs.readFileSync(keepTokenContractJsonFile));
const keepTokenContractAbi = keepTokenContractParsed.abi;
const keepTokenContractAddress = keepTokenContractParsed.networks[ethNetworkId].address;
const keepTokenContract = new web3.eth.Contract(keepTokenContractAbi, keepTokenContractAddress);

// keepRandomBeaconService, only contract address for config file create
const keepRandomBeaconServiceJsonFile = '/tmp/KeepRandomBeaconService.json';
const keepRandomBeaconServiceParsed = JSON.parse(fs.readFileSync(keepRandomBeaconServiceJsonFile));
const keepRandomBeaconServiceContractAddress = keepRandomBeaconServiceParsed.networks[ethNetworkId].address;

// KeepRandomBeaconOperator, only contract address for config file create
const keepRandomBeaconOperatorJsonFile = '/tmp/KeepRandomBeaconOperator.json';
const keepRandomBeaconOperatorParsed = JSON.parse(fs.readFileSync(keepRandomBeaconOperatorJsonFile));
const keepRandomBeaconOperatorContractAddress = keepRandomBeaconOperatorParsed.networks[ethNetworkId].address;

async function provisionKeepClient() {

  try {
    // Account that we fund ether from.  Contract owner should always have ether.
    let purse = process.env.CONTRACT_OWNER_ETH_ACCOUNT_ADDRESS;
    // Operator account, should be set in Kube config
    let operatorAddress = process.env.KEEP_CLIENT_ETH_ACCOUNT
    let operatorKeyfile = process.env.KEEP_CLIENT_ETH_KEYFILE

    console.log(`\n<<<<<<<<<<<< Funding Operator Account ${operatorAddress} >>>>>>>>>>>>`);
    await fundOperator(operatorAddress, purse, '10');

    console.log(`\n<<<<<<<<<<<< Staking Operator Account ${operatorAddress} >>>>>>>>>>>>`);
    await stakeOperator(operatorAddress, contractOwnerAddress);

    console.log('\n<<<<<<<<<<<< Creating keep-client Config File >>>>>>>>>>>>');
    await createKeepClientConfig(operatorAddress);
  }
  catch(error) {
    console.error(error.message);
    throw error;
  }
};

async function isStaked(operatorAddress) {

  console.log('Checking if operator address is staked:');
  let stakedAmount = await tokenStakingContract.methods.balanceOf(operatorAddress).call();
  return stakedAmount != 0;
}

async function isFunded(operatorAddress) {

  console.log('Checking if operator address has ether:')
  let fundedAmount = await web3.fromWei(eth.getBalance(operatorAddress), 'ether')
  return isFunded !< 1;
}

async function stakeOperator(operatorAddress, contractOwnerAddress) {

  let magpie = contractOwnerAddress;
  let authorizer = contractOwnerAddress;
  let staked = await isStaked(operatorAddress);

  /*
  We need to stake only in cases where an operator account is not already staked.  If the account
  is staked, or the client type is relay-requester we need to exit staking, albeit for different
  reasons.  In the case where the account is already staked, additional staking will fail.
  Clients of type relay-requester don't need to be staked to submit a request, they're acting more
  as a consumer of the network, rather than an operator.
  */
  if (process.env.KEEP_CLIENT_TYPE === 'relay-requester') {
    console.log('Subtype relay-requester set. No staking needed, exiting staking!');
    return;
  } else if (staked === true) {
    console.log('Operator account already staked, exiting!');
    return;
  } else {
    console.log('Staking operator account!');
  }

  let delegation = '0x' + Buffer.concat([
    Buffer.from(magpie.substr(2), 'hex'),
    Buffer.from(operatorAddress.substr(2), 'hex'),
    Buffer.from(authorizer.substr(2), 'hex')
  ]).toString('hex');

  console.log(`Staking 2000000 KEEP tokens on operator account ${operatorAddress}`);

  await keepTokenContract.methods.approveAndCall(
    tokenStakingContract.address,
    formatAmount(20000000, 18),
    delegation).send({from: contractOwnerAddress})

  await tokenStakingContract.authorizeOperatorContract(
    operatorAddress,
    keepRandomBeaconOperatorContractAddress,
    {from: authorizer});

  console.log(`Account ${operatorAddress} staked!`);
};

async function fundOperator(operatorAddress, purse, etherToTransfer) {

  let funded = await isFunded(operatorAddress);
  let transferAmount = web3.utils.toWei(etherToTransfer, 'ether');

  if (funded === true) {
    console.log('Operator address is already funded, exiting!');
    return;
  } else {
    console.log(`Funding account ${operatorAddress} with ${etherToTransfer} ether from purse ${purse}`);
    await web3.eth.sendTransaction({from:purse, to:operatorAddress, value:transferAmount});
    console.log(`Account ${operatorAddress} funded!`);
  }
};

async function createKeepClientConfig(operatorAddress) {

  fs.createReadStream('/tmp/keep-client-config-template.toml', 'utf8').pipe(concat(function(configFileStream) {

    let parsedConfigFile = toml.parse(configFileStream);

    parsedConfigFile.ethereum.URL = `${ethWSHost}:${ethWsPort}`;
    parsedConfigFile.ethereum.URLRPC = `${ethRPCHost}:${ethRpcPort}`;
    parsedConfigFile.ethereum.account.Address = operatorAddress;
    parsedConfigFile.ethereum.account.KeyFile = operatorKeyfile;
    parsedConfigFile.ethereum.ContractAddresses.KeepRandomBeaconOperator = keepRandomBeaconOperatorContractAddress;
    parsedConfigFile.ethereum.ContractAddresses.KeepRandomBeaconService = keepRandomBeaconServiceContractAddress;
    parsedConfigFile.ethereum.ContractAddresses.TokenStaking = tokenStakingContractAddress;
    parsedConfigFile.LibP2P.Port = 3919;
    parsedConfigFile.Storage.DataDir = process.env.KEEP_DATA_DIR;

    /*
    tomlify.toToml() writes our Seed/Port values as a float.  The added precision renders our config
    file unreadable by the keep-client as it interprets 3919.0 as a string when it expects an int.
    Here we format the default rendering to write the config file with Seed/Port values as needed.
    */
    let formattedConfigFile = tomlify.toToml(parsedConfigFile, {
      replace: (key, value) => { return (key == 'Port') ? value.toFixed(0) : false }
    });

    fs.writeFile('/mnt/keep-client/config/keep-client-config.toml', formattedConfigFile, (error) => {
      if (error) throw error;
    });
  }));
  console.log('keep-client config written to /mnt/keep-client/config/keep-client-config.toml');
};

/*
\heimdall aliens numbers.  Really though, the approveAndCall function expects numbers
in a particular format, this function facilitates that.
*/
function formatAmount(amount, decimals) {
  return '0x' + web3.utils.toBN(amount).mul(web3.utils.toBN(10).pow(web3.utils.toBN(decimals))).toString('hex');
};

provisionKeepClient().catch(error => {
  console.error(error);
  process.exit(1);
});

