#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createSigner } from "./signer.js";
import { exportChain } from "./exporter.js";
import { expandInputs, isPlainPath } from "./files.js";

const KV_FLAGS = new Set(["-kvu", "-kvt", "-kvi", "-kvs", "-kvc", "-tr", "-td"]);
const DEFAULT_CONCURRENCY = 16;

const HELP = `sign-sbom - sign CycloneDX SBOM JSON files with an embedded signature via Azure Key Vault

Usage:
  sign-sbom <file.json> [signedfile.json]
  sign-sbom <file|mask|@list>... [--out-dir <dir>] [--fail-fast] [--concurrency <n>]
  sign-sbom <signedfile.json> --export-key [basename]

Signing:
  <file.json>        Input CycloneDX SBOM JSON to sign.
  [signedfile.json]  Output path. Exactly two plain paths mean input and output.
                     If omitted, the input file is signed in place.
  <mask>             Glob mask (quote it): * ? ** [abc] [a-z] [!a] {a,b}.
                     Example: "dist/**/*.json". Dot entries and node_modules are
                     skipped unless named explicitly.
  @<list.txt>        File list: one path or mask per line, '#' starts a comment.
  !<path|mask>       Exclude matching files (e.g. "!dist/skip.json").
  --out-dir <dir>    Write signed copies into <dir> (basenames must be unique).
                     Without it, every input is signed in place.
  --fail-fast        Stop at the first failure. By default the remaining files
                     are still signed and the exit code is 1 if any failed.
  --concurrency <n>  Files signed in parallel (default ${DEFAULT_CONCURRENCY}; 1 = sequential).
                     Each file makes 2 sign requests (1 with --single). If Key Vault
                     throttles (HTTP 429), lower <n>.
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
    failFast: false,
    outDir: undefined,
    concurrency: DEFAULT_CONCURRENCY,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (KV_FLAGS.has(a)) {
      if (i + 1 >= argv.length) {
        throw new Error(`Flag ${a} requires a value`);
      }
      args[a.slice(1)] = argv[++i];
    } else if (a === "--out-dir") {
      if (i + 1 >= argv.length) {
        throw new Error(`Flag ${a} requires a value`);
      }
      args.outDir = argv[++i];
    } else if (a === "--concurrency") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error("Flag --concurrency requires a positive integer");
      }
      args.concurrency = n;
    } else if (a === "--fail-fast") {
      args.failFast = true;
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

  const jobs = planJobs(args);
  const signer = await createSigner(env);

  const results = new Array(jobs.length);
  let printed = 0;
  let stop = false;

  // Print results in input order as soon as the leading ones are complete.
  const flush = () => {
    while (printed < jobs.length && results[printed]) {
      const r = results[printed++];
      if (r.error) console.error(`FAILED: ${r.input}: ${r.error}`);
      else console.log(`Signed: ${r.output}`);
    }
  };

  let next = 0;
  const worker = async () => {
    while (!stop && next < jobs.length) {
      const idx = next++;
      const { input, output } = jobs[idx];
      try {
        const bom = readJson(input);
        if (!bom || typeof bom !== "object" || bom.bomFormat !== "CycloneDX") {
          throw new Error(`Not a CycloneDX SBOM (missing bomFormat): ${input}`);
        }
        const signed = await signer.sign(bom, { single: args.single });
        writeFileAtomic(output, JSON.stringify(signed));
        results[idx] = { input, output };
      } catch (e) {
        const hint =
          e.status === 429 ? " (Key Vault is throttling requests; try a lower --concurrency)" : "";
        results[idx] = { input, output, error: e.message + hint };
        if (args.failFast) stop = true;
      }
      flush();
    }
  };
  const workers = Math.min(args.concurrency, jobs.length);
  await Promise.all(Array.from({ length: workers }, worker));

  const done = results.filter(Boolean);
  const failed = done.filter((r) => r.error).length;
  console.log(`keyId:  ${signer.keyId}`);
  if (jobs.length > 1) {
    const skipped = jobs.length - done.length;
    console.log(
      `${done.length - failed} signed, ${failed} failed` +
        (skipped ? `, ${skipped} skipped` : ""),
    );
  }
  if (failed) process.exitCode = 1;
}

// Turn positional arguments into a list of { input, output } jobs.
function planJobs(args) {
  const { positional, outDir } = args;

  // Backward compatible form: exactly two plain paths are input and output.
  if (!outDir && positional.length === 2 && positional.every(isPlainPath)) {
    return [{ input: positional[0], output: positional[1] }];
  }

  const inputs = expandInputs(positional);
  if (!outDir) return inputs.map((input) => ({ input, output: input }));

  const seen = new Map();
  const jobs = inputs.map((input) => {
    const name = basename(input);
    const key = process.platform === "win32" ? name.toLowerCase() : name;
    if (seen.has(key)) {
      throw new Error(
        `Name collision in --out-dir: ${seen.get(key)} and ${input} both map to ${name}`,
      );
    }
    seen.set(key, input);
    return { input, output: join(outDir, name) };
  });
  mkdirSync(resolve(outDir), { recursive: true });
  return jobs;
}

// Write to a temporary sibling first so a failed write never corrupts the target.
function writeFileAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // temporary file was not created
    }
    throw e;
  }
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
