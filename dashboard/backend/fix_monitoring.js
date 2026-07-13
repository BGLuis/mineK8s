const fs = require('fs');

let mon = fs.readFileSync(
	'dashboard/backend/src/monitoring/monitoring.service.ts',
	'utf8',
);

const interfaces = `
interface PodMetrics {
	metadata: {
		name: string;
		labels?: Record<string, string>;
	};
	containers?: {
		usage: {
			cpu: string;
			memory: string;
		};
	}[];
}
`;

// Insert the interfaces after imports
mon = mon.replace(
	/import \{ ServerMetrics \} from '\.\.\/tmp_agents\/types';\n/g,
	"import { ServerMetrics } from '../tmp_agents/types';\n" +
		interfaces +
		'\n',
);

// Fix the cast
mon = mon.replace(
	/res\.body as \{ items: Record<string, unknown>\[\] \}/g,
	'res.body as { items: PodMetrics[] }',
);

fs.writeFileSync('dashboard/backend/src/monitoring/monitoring.service.ts', mon);
