
// OVERRIDING CLI FOR TESTING PURPOSES

import fnetConfig from '@fnet/config';
import Node from "../src/index.js";

export default async ({ config = "basic-01-simple-commands" } = {}) => {
  const args = (await fnetConfig({ rel: "../tests", name: config })).data;
  const result = await Node(args);

  // If result contains captured data, log it
  if (result) {
    console.log('\n=== Captured Output ===');
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
};
