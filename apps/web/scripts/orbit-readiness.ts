import { evaluateProductionReadiness } from '../lib/production-readiness';

const issues = evaluateProductionReadiness(process.env);
if (issues.length > 0) {
  console.error(JSON.stringify({ ready: false, issues }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ready: true, issues: [] }, null, 2));
}
