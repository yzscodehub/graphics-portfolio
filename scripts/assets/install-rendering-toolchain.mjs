import { installRenderingToolchain, projectRoot } from "./toolchain.mjs";

if (process.argv.includes("--help")) {
  console.log("Downloads the hash-locked local rendering toolchain into .tools/rendering.");
  console.log("This is explicit local work; CI only runs schema verification.");
} else {
  try {
    await installRenderingToolchain(projectRoot);
    console.log("Rendering toolchain installed and verified in .tools/rendering.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Toolchain installation failed.");
    process.exitCode = 1;
  }
}
