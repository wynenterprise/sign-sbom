#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { signSbom } from "./signer.js";
import { exportChain } from "./exporter.js";

const KV_FLAGS = new Set(["-kvu", "-kvt", "-kvi", "-kvs", "-kvc", "-tr", "-td"]);

const HELP = `sign-sbom - sign a CycloneDX SBOM JSON with an embedded signature via Azure Key Vault

Usage:
  sign-sbom <file.json> [signedfile.json]
  sign-sbom <signedfile.json> --export-key [basename]

Signing:
  <file.json>        Input CycloneDX SBOM JSON to sign.
  [signedfile.json]  Output path. If omitted, the input file is signed in place.
  --single           Emit a single legacy signature (verifies on cdx-verify
                     <= 12.8.4 only). By default the SBOM gets two signatures
                     (signature.signers) that verify on both cdx-verify <= 12.8.4
                     and >= 12.8.5.

Export (no Azure credentials needed - reads signature.certificatePath):
  --export-key [output]
                     Write the public key from a signed SBOM to <output>
                     (default: public.key), for use with cdx-verify.

  -h, --help         Show this help.

Azure Key Vault credentials (override env vars):
  -kvu <url>     Vault URL        (AZURE_VAULT_URI)
  -kvt <id>      Tenant ID        (AZURE_TENANT_ID)
  -kvi <id>      Client ID        (AZURE_CLIENT_ID)
  -kvs <secret>  Client secret    (AZURE_CLIENT_SECRET)
  -kvc <name>    Certificate name (AZURE_CERT_NAME)

Environment variables (required for signing only):
  AZURE_TENANT_ID      AAD tenant id
  AZURE_CLIENT_ID      Service principal app id
  AZURE_CLIENT_SECRET  Service principal secret
  AZURE_VAULT_URI      e.g. https://my-vault.vault.azure.net
  AZURE_CERT_NAME      Certificate name in the vault`;

function parseArgs(argv) {
  const args = {
    positional: [],
    exportKey: false,
    single: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (KV_FLAGS.has(a)) {
      if (i + 1 >= argv.length) {
        throw new Error(`Flag ${a} requires a value`);
      }
      args[a.slice(1)] = argv[++i];
    } else if (a === "--export-key") {
      args.exportKey = true;
    } else if (a === "--single") {
      args.single = true;
    } else if (a === "-h" || a === "--help") {
      args.help = true;
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(`File not found: ${path}`);
    }
    throw new Error(`Cannot read ${path}: ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON in ${path}: ${e.message}`);
  }
}

function runExport(input, outputArg) {
  const bom = readJson(input);
  const sig = bom?.signature;
  const certificatePath =
    sig?.certificatePath ??
    sig?.signers?.find((s) => s?.certificatePath)?.certificatePath;
  if (!certificatePath) {
    throw new Error(`No signature.certificatePath found in ${input}`);
  }

  const { chainPem, info } = exportChain(certificatePath);
  const outFile = outputArg || "public.key";
  writeFileSync(outFile, chainPem, "utf8");

  for (const c of info) {
    console.log(`Subject:  ${c.subject.replace(/\n/g, ", ")}`);
    console.log(`Issuer:   ${c.issuer.replace(/\n/g, ", ")}`);
    console.log(`Valid to: ${c.validTo}`);
  }
  console.log(`Saved:    ${outFile}`);
  console.log("");
  console.log("To verify the SBOM signature:");
  console.log(
    `  npx -p @cyclonedx/cdxgen cdx-verify -i ${input} --public-key ${outFile}`,
  );
}

async function runSign(args) {
  const env = {
    tenantId:     args.kvt ?? process.env.AZURE_TENANT_ID,
    clientId:     args.kvi ?? process.env.AZURE_CLIENT_ID,
    clientSecret: args.kvs ?? process.env.AZURE_CLIENT_SECRET,
    vaultUri:     args.kvu ?? process.env.AZURE_VAULT_URI,
    certName:     args.kvc ?? process.env.AZURE_CERT_NAME,
  };

  const missing = [
    [env.tenantId,     "AZURE_TENANT_ID / -kvt"],
    [env.clientId,     "AZURE_CLIENT_ID / -kvi"],
    [env.clientSecret, "AZURE_CLIENT_SECRET / -kvs"],
    [env.vaultUri,     "AZURE_VAULT_URI / -kvu"],
    [env.certName,     "AZURE_CERT_NAME / -kvc"],
  ].filter(([v]) => !v).map(([, l]) => l);

  if (missing.length) {
    console.error("Missing required parameters:\n  " + missing.join("\n  "));
    process.exit(1);
  }

  const input = args.positional[0];
  const output = args.positional[1] || input;

  const bom = readJson(input);
  if (!bom || typeof bom !== "object" || bom.bomFormat !== "CycloneDX") {
    throw new Error(`Not a CycloneDX SBOM (missing bomFormat): ${input}`);
  }
  const signed = await signSbom(bom, env, { single: args.single });
  writeFileSync(output, JSON.stringify(signed), "utf8");

  const keyId = signed.signature.keyId ?? signed.signature.signers[0].keyId;
  console.log(`Signed: ${output}`);
  console.log(`keyId:  ${keyId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (args.positional.length === 0) {
    console.error(HELP);
    process.exit(1);
  }

  if (args.exportKey) {
    runExport(args.positional[0], args.positional[1]);
    return;
  }

  await runSign(args);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
