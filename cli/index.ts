import readline from 'node:readline/promises';

// ============================================================
// 统一的命令行输入会话
//
// 为什么需要它：直接 `await rl.question()` + Ctrl+C 会崩/卡死。实测结论：
//   - Ctrl+C 时 readline 在没有 SIGINT 监听器的情况下会自己 rl.close()；
//   - 而 close 之后，那个还挂着的 question() promise **既不 resolve 也不 reject**
//     （永不 settle）→ 主循环卡死；若被外层 await，Node 报 unsettled top-level await 并以非 0 退出。
//
// 所以这里自己做三件事：
//   1. 接管 SIGINT：置 stopped 标志 + 主动结算挂起的提问（返回 null）+ 关闭 interface；
//   2. ask() 永远返回 string 或 null，不会抛、不会挂；
//   3. close() 负责摘掉监听器，避免重复注册 / 影响后续。
// ============================================================

export type PromptSession = {
  /** 安全提问。返回 null 表示用户 Ctrl+C 或输入流已关闭，调用方应结束循环。 */
  ask: (prompt: string) => Promise<string | null>;
  /** 是否已经收到 Ctrl+C */
  stopped: () => boolean;
  /** 摘掉 SIGINT 监听并关闭 interface。退出前调用一次即可。 */
  close: () => void;
};

export type PromptSessionOptions = {
  /** Ctrl+C 时的提示语 */
  onSigintMessage?: string;
};

export function createPromptSession(opts: PromptSessionOptions = {}): PromptSession {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let stopped = false;
  let settled = false;
  // 当前挂起的 ask 的结算函数；SIGINT 或 close 时用它把 promise 唤醒
  let pendingResolve: ((value: string | null) => void) | null = null;

  const settlePending = (value: string | null) => {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(value);
  };

  const onSigint = () => {
    if (stopped) {
      // 第二次 Ctrl+C：不再等业务收尾，直接强退（130 = 被 SIGINT 终止的惯例退出码）
      console.log('\n已强制退出。');
      process.exit(130);
    }
    stopped = true;
    console.log('\n' + (opts.onSigintMessage ?? '正在退出……（再按一次 Ctrl+C 可强制退出）'));
    settlePending(null);
    rl.close();
  };

  process.on('SIGINT', onSigint);

  // stdin 被关闭（管道 EOF、终端消失等）时 readline 会触发 close，
  // 但挂起的 question() 同样不会 settle —— 必须在这里主动结算，否则进程挂死。
  rl.on('close', () => {
    stopped = true;
    settlePending(null);
  });

  const ask = (prompt: string): Promise<string | null> => {
    if (stopped || settled) return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      // 若同一时刻已有挂起的提问，先把它结束掉，避免两个 promise 抢同一个 resolver
      pendingResolve?.(null);
      pendingResolve = resolve;

      const done = (value: string | null) => {
        // 只结算自己这一次，防止迟到回调覆盖新的挂起提问
        if (pendingResolve === resolve) pendingResolve = null;
        resolve(value);
      };

      rl.question(prompt).then(
        (answer) => done(answer ?? null),
        () => done(null), // ERR_USE_AFTER_CLOSE 等：一律视为正常结束
      );
    });
  };

  const close = () => {
    settled = true;
    process.off('SIGINT', onSigint);
    settlePending(null);
    rl.close();
  };

  return { ask, stopped: () => stopped, close };
}
