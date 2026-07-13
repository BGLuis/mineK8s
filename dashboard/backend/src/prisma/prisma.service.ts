import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';
import Database from 'better-sqlite3';
import { AppConfigService } from '../app-config/app-config.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
	constructor(readonly appConfig: AppConfigService) {
		const dbPath = appConfig.databaseUrl.replace('file:', '') || './dev.db';
		const db = new Database(dbPath);
		const adapter = new PrismaBetterSqlite3(db);
		super({ adapter });
	}

	async onModuleInit() {
		// connect() implícito na primeira query
	}
}
