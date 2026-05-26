import { Global, Logger, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InMemoryStorageClient, S3StorageClient, type IStorageClient } from '@cureocity/storage';
import { NoopBackend, WatiBackend, type IMessagingPort } from '@cureocity/notifications';

export const STORAGE_CLIENT = Symbol('STORAGE_CLIENT');
export const MESSAGING_PORT = Symbol('MESSAGING_PORT');

const storageProvider: Provider = {
  provide: STORAGE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IStorageClient => {
    const logger = new Logger('StorageFactory');
    if (config.get<string>('STORAGE_BACKEND') === 's3') {
      const region = config.get<string>('S3_REGION');
      const endpoint = config.get<string>('S3_ENDPOINT');
      const accessKey = config.get<string>('S3_ACCESS_KEY');
      const secretKey = config.get<string>('S3_SECRET_KEY');
      if (!region || !accessKey || !secretKey) {
        throw new Error(
          'STORAGE_BACKEND=s3 requires S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY (and optionally S3_ENDPOINT for MinIO)',
        );
      }
      return new S3StorageClient({
        region,
        ...(endpoint !== undefined && { endpoint, forcePathStyle: true }),
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      });
    }
    logger.warn('STORAGE_BACKEND=in-memory — treatment-plan WhatsApp links will be ephemeral');
    return new InMemoryStorageClient();
  },
};

const messagingProvider: Provider = {
  provide: MESSAGING_PORT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IMessagingPort => {
    const logger = new Logger('MessagingFactory');
    if (config.get<string>('MESSAGING_BACKEND') === 'wati') {
      const apiBase = config.get<string>('WATI_API_BASE');
      const token = config.get<string>('WATI_BEARER_TOKEN');
      if (!apiBase || !token) {
        throw new Error('MESSAGING_BACKEND=wati requires WATI_API_BASE and WATI_BEARER_TOKEN');
      }
      return new WatiBackend({ apiBase, bearerToken: token });
    }
    logger.warn(
      'MESSAGING_BACKEND=noop — WhatsApp sends will be recorded but not actually delivered',
    );
    return new NoopBackend();
  },
};

@Global()
@Module({
  providers: [storageProvider, messagingProvider],
  exports: [storageProvider, messagingProvider],
})
export class DeliveryModule {}
