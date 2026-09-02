import {
  loadToolchainLock,
  projectRoot,
  validateToolchainLock,
  verifyInstalledToolchain,
} from "./toolchain.mjs";

const schemaOnly = process.argv.includes("--schema-only");
const lock = loadToolchainLock(projectRoot);
const issues = schemaOnly
  ? validateToolchainLock(lock)
  : verifyInstalledToolchain(projectRoot, { lock });

if (issues.length > 0) {
  console.error(`Rendering toolchain ${schemaOnly ? "schema" : "local"} verification failed:`);
  issues.forEach((issue) => console.error(`- ${issue}`));
  process.exitCode = 1;
} else if (schemaOnly) {
  console.log("Rendering toolchain lock schema passed; CI does not download or install tools.");
} else {
  console.log(
    "Rendering toolchain archives, executables, support artifacts, versions, and Sharp checks passed.",
  );
}
