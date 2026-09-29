import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { CloudflareDnsDriver } from './drivers/cloudflare-dns.driver';

@Module({
  imports: [AppConfigModule],
  providers: [CloudflareDnsDriver],
  exports: [CloudflareDnsDriver],
})
export class DnsModule {}
