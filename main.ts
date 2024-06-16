import { TonClient, WalletContractV4, internal } from "ton";
import { Cell, } from "ton-core";
import { mnemonicToPrivateKey } from "ton-crypto";
import { readFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from "util";
import dotenv from 'dotenv';

dotenv.config();

const MY_ADDRESS = process.env.MY_ADDRESS!
const IS_TESTNET = process.env.IS_TESTNET === '1';
const MNEMONIC = (process.env.MNEMONIC!).split(' ');
const TONCONSOLE_BEARER = process.env.TONCONSOLE_BEARER;

const TON_URL = IS_TESTNET ? 'https://testnet.toncenter.com/api/v2/jsonRPC' : 'https://toncenter.com/api/v2/jsonRPC';
const TONAPIIO_URL = IS_TESTNET ? 'https://testnet.tonapi.io/v2' : 'https://tonapi.io/v2';
const GIVER_ADDRESS = IS_TESTNET ? 'EQDe1EaGTLsqY5K_lQcqViPXxBg6ANjlZ3v4PxzaQkolOqW8' : '';

const execAsync = promisify(exec);

const client = new TonClient({
  endpoint: TON_URL,
  apiKey: process.env.TONCENTER_API_KEY
});

async function getParams(address: string) {
  const res = await fetch(
    `${TONAPIIO_URL}/blockchain/accounts/${address}/methods/get_pow_params`,
    {
      headers: {
        accept: "application/json",
        ...(TONCONSOLE_BEARER && {
          Authorization: "Bearer " + TONCONSOLE_BEARER,
        })
      },
    }
  );

  return (await res.json()).stack;
}


function parseParams(params: any[]) {
  let paramsString = ''
  for (let i = 0; i < params.length - 1; i++) {
    if (params[i].type == 'num') {
      paramsString += BigInt(params[i].num).toString() + ' '
    }
  }

  return paramsString
}

async function runCommandAndHandleResult(): Promise<void> {
  try {
    const params = parseParams(await getParams(GIVER_ADDRESS));
    const command = `bin/pow-miner-linux-amd64 -vv -w30 -t500 ${MY_ADDRESS} ${params} ${GIVER_ADDRESS} mined.boc`;

    console.log("[Starting mining]")
    const { stdout, stderr } = await execAsync(command, { timeout: 1000 * 1000 }); // 100 seconds timeout

    if (stderr && !stderr.includes("bytes of serialized external message into file `mined.boc`")) {
      console.log("[Error in command]")
      throw new Error(`Error in command execution: ${stderr}`);
    }

    const buffer = readFileSync('./mined.boc');
    const cell = Cell.fromBoc(buffer)[0].asSlice().loadRef()

    let keyPair = await mnemonicToPrivateKey(MNEMONIC);
    let wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    let contract = client.open(wallet);

    console.log(contract.address.toString({ urlSafe: true, bounceable: false }))
    let seqno: number = await contract.getSeqno();
    let transfer = contract.createTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [internal({
        value: '0.05',
        to: GIVER_ADDRESS,
        body: cell
      })]
    });

    console.log("[Sending transaction]")
    contract.send(transfer)

  } catch (error) {
    console.log(error)
  }
}

async function main() {
  while (true) {
    await runCommandAndHandleResult();
  }
}

(async () => {
  await main();
})();
