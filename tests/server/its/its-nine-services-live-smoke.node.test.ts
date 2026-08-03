// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createItsContractObservation,
  formatItsContractObservationReport,
  hasDocumentedCoreFields,
  ITS_CONTRACT_MAX_RESPONSE_BYTES,
  ITS_SERVICE_CONTRACTS,
  ItsContractProbeError,
  isT26LiveObservationAccepted,
  probeItsServiceContract,
  readItsLiveSmokeCredential,
} from './its-nine-services-contract';

const liveRequested = process.env.RUN_ITS_NINE_SERVICES_LIVE_SMOKE === '1';
const liveIt = liveRequested ? it : it.skip;

describe('ITS nine-service explicit live contract gate', () => {
  liveIt(
    'probes every approved service exactly once without retaining provider values',
    async () => {
      const serviceKey = readItsLiveSmokeCredential(process.env);
      if (serviceKey === undefined) {
        throw new Error('ITS nine-service live smoke gate is disabled');
      }

      const results = await Promise.allSettled(
        ITS_SERVICE_CONTRACTS.map(async (contract) => ({
          contract,
          summary: await probeItsServiceContract({
            contract,
            fetcher: globalThis.fetch,
            now: Date.now(),
            serviceKey,
            signal: AbortSignal.timeout(12_000),
          }),
        })),
      );
      const failures: string[] = [];
      const observations = [];
      const summaries = [];

      for (const [index, result] of results.entries()) {
        const contract = ITS_SERVICE_CONTRACTS[index];
        if (contract === undefined) {
          failures.push('matrix:unexpected');
          continue;
        }
        if (result.status === 'rejected') {
          const category = result.reason instanceof ItsContractProbeError ? result.reason.category : 'unexpected';
          failures.push(`${contract.key}:${category}`);
          continue;
        }
        const { summary } = result.value;
        const observation = createItsContractObservation(contract, summary);
        observations.push(observation);
        if (!isT26LiveObservationAccepted(contract, observation)) {
          failures.push(`${contract.key}:schema-${observation.schemaStatus}`);
        } else if (observation.schemaStatus === 'observed' && !hasDocumentedCoreFields(contract, summary)) {
          failures.push(`${contract.key}:schema-fields`);
        }
        summaries.push(summary);
      }

      console.info(`ITS_CONTRACT_OBSERVATIONS ${formatItsContractObservationReport(observations)}`);

      if (failures.length > 0) {
        throw new Error(`ITS nine-service live contract failures: ${failures.join(',')}`);
      }

      expect(summaries).toHaveLength(ITS_SERVICE_CONTRACTS.length);
      expect(summaries.map(({ service }) => service)).toEqual(ITS_SERVICE_CONTRACTS.map(({ key }) => key));
      expect(
        summaries.every(({ responseBytes }) => responseBytes > 0 && responseBytes <= ITS_CONTRACT_MAX_RESPONSE_BYTES),
      ).toBe(true);
    },
    20_000,
  );
});
