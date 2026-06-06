import {
  type GeminiCallLogData,
  type IModelRouter,
  type IPass1Backend,
  type IPass2Backend,
  type IPass3Backend,
  type Pass1Input,
  type Pass1Output,
  type Pass2Input,
  type Pass2Output,
  type Pass3Input,
  type Pass3Output,
} from './types';

export interface ModelRouterOptions {
  pass1: IPass1Backend;
  pass2: IPass2Backend;
  pass3: IPass3Backend;
  /** Called after every backend call with the resulting call-log row. */
  onCallLog?: (log: GeminiCallLogData) => Promise<void> | void;
}

export class ModelRouter implements IModelRouter {
  constructor(private readonly opts: ModelRouterOptions) {}

  async pass1(input: Pass1Input): Promise<{ output: Pass1Output; callLog: GeminiCallLogData }> {
    const result = await this.opts.pass1.run(input);
    await this.opts.onCallLog?.(result.callLog);
    return result;
  }

  async pass2(input: Pass2Input): Promise<{ output: Pass2Output; callLog: GeminiCallLogData }> {
    const result = await this.opts.pass2.run(input);
    await this.opts.onCallLog?.(result.callLog);
    return result;
  }

  async pass3(input: Pass3Input): Promise<{ output: Pass3Output; callLog: GeminiCallLogData }> {
    const result = await this.opts.pass3.run(input);
    await this.opts.onCallLog?.(result.callLog);
    return result;
  }
}
