import {recordApplicationOutcome} from './application-outcome.mjs';

// Persist only the confirmed native plan; no external adapters or processes.
export async function closeApplication(args) {
 const recorded = await recordApplicationOutcome(args);
 return {...recorded, status: 'closed', websiteAction: 'none'};
}
