import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { appConfigSchema } from './app-config.schema';
import { AppConfigService } from './app-config.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: appConfigSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
