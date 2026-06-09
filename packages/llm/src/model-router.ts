import {
  type GeminiCallLogData,
  type IModelRouter,
  type IPass1Backend,
  type IPass2Backend,
  type IPass3Backend,
  type IPass4Backend,
  type IPass5Backend,
  type IPass6Backend,
  type IPass7Backend,
  type Pass1Input,
  type Pass1Output,
  type Pass2Input,
  type Pass2Output,
  type Pass3Input,
  type Pass3Output,
  type Pass4Input,
  type Pass4Output,
  type Pass5Input,
  type Pass5Output,
  type Pass6Input,
  type Pass6Output,
  type Pass7Input,
  type Pass7Output,
} from './types';

export interface ModelRouterOptions {
  pass1: IPass1Backend;
  pass2: IPass2Backend;
  pass3: IPass3Backend;
  pass4: IPass4Backend;
  pass5: IPass5Backend;
  pass6: IPass6Backend;
  pass7: IPass7Backend;
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

  async pass4(input: Pass4Input): Promise<{ output: Pass4Output; callLog: GeminiCallLogData }> {
    const result = await this.opts.pass4.run(input);
    await this.opts.onCallLog?.(result.callLog);
    return result;
  }

  async pass5(input: Pass5Input): Promise<{ output: Pass5Output; callLog: GeminiCallLogData }> {
    const result = await this.opts.pass5.run(input);
    await this.opts.onCallLog?.(result.callLog);
    return result;
  }

  async pass6(input: Pass6Input): Promise<{ output: Pass6Output; callLog: GeminiCallLogData }> {
    const result = await this.opts.pass6.run(input);
    await this.opts.onCallLog?.(result.callLog);
    return result;
  }

  async pass7(input: Pass7Input): Promise<{ output: Pass7Output; callLog: GeminiCallLogData }> {
    const result = await this.opts.pass7.run(input);
    await this.opts.onCallLog?.(result.callLog);
    return result;
  }
}
