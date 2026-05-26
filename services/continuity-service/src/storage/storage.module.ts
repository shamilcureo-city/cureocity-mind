import { Global, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InMemoryStorageClient, S3StorageClient, type IStorageClient } from '@cureocity/storage';

export const STORAGE_CLIENT = Symbol('STORAGE_CLIENT');

const storageProvider: Provider = {
  provide: STORAGE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IStorageClient => {
    if (config.get<string>('STORAGE_BACKEND') === 'memory') {
      return new InMemoryStorageClient();
    }
    return new S3StorageClient({
      endpoint: config.get<string>('S3_ENDPOINT'),
      region: config.get<string>('S3_REGION') ?? 'us-east-1',
      accessKeyId: config.get<string>('S3_ACCESS_KEY') ?? '',
      secretAccessKey: config.get<string>('S3_SECRET_KEY') ?? '',
      forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE') ?? true,
    });
  },
};

@Global()
@Module({
  providers: [storageProvider],
  exports: [storageProvider],
})
export class StorageModule {}
