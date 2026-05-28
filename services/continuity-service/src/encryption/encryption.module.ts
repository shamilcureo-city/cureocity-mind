import { Global, Logger, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDevKmsProvider, type IKmsProvider } from '@cureocity/crypto';
import { EncryptionService } from './encryption.service';

export const KMS_PROVIDER = Symbol('KMS_PROVIDER');

const kmsProvider: Provider = {
  provide: KMS_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService): IKmsProvider => {
    const logger = new Logger('KmsFactory');
    const backend = config.get<string>('KMS_BACKEND') ?? 'local-dev';
    if (backend === 'aws') {
      // AwsKmsProvider requires the @aws-sdk/client-kms instance + command
      // factories to be wired here. The factory throws loudly when env vars
      // aren't set so misconfigured prod fails at startup, not at first
      // encrypt. Sprint 10 hardening will swap LocalDevKmsProvider out by
      // default once KMS credentials are in place.
      throw new Error(
        'KMS_BACKEND=aws is wired but not bootstrapped in this build — set KMS_BACKEND=local-dev or extend this factory with @aws-sdk/client-kms',
      );
    }
    logger.warn('KMS_BACKEND=local-dev — using LocalDevKmsProvider. NOT FOR PRODUCTION.');
    const secret = config.get<string>('CRYPTO_DEV_MASTER_SECRET');
    return new LocalDevKmsProvider({
      ...(secret !== undefined && { devMasterSecret: secret }),
    });
  },
};

@Global()
@Module({
  providers: [kmsProvider, EncryptionService],
  exports: [EncryptionService, kmsProvider],
})
export class EncryptionModule {}
