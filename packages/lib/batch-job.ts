import { ApiObject, type Chart } from "cdk8s";

/** CronJob / Job のコンテナ1件分の定義。 */
export interface CjobContainer {
  /** コンテナ名。 */
  readonly name: string;
  /** コンテナイメージ。 */
  readonly image: string;
  /** コンテナのエントリポイント。 */
  readonly command?: readonly string[];
  /** コンテナに渡す引数。 */
  readonly args?: readonly string[];
}

/** CronJob / Job に共通するオプション。 */
export interface CjobCommonOptions {
  /** 対象 namespace。 */
  readonly namespace: string;
  /** 失敗時の再試行回数上限。指定しない場合は CronJob は 2, Job は 0 にされる。 */
  readonly backoffLimit?: number;
  /** Job 全体のタイムアウト（秒）。指定しない場合は制限なし。 */
  readonly activeDeadlineSeconds?: number;
}

/** CronJob のスケジュールを記述するためのオブジェクト。 */
export interface ScheduleSyntax {
  /** 時 (0-23)。 */
  readonly hours: number;
  /** 分 (0-59)。 */
  readonly minutes: number;
  /** 日 (1-31)。省略時 = 全日 */
  readonly days?: number;
  /** 月 (1-12)。省略時 = 全月 */
  readonly months?: number;
  /** 曜日 (0-6, 0=日)。省略時 = 全曜日 */
  readonly weekdays?: number;
}

/** CronJob のスケジュールタイプ。 */
export type ScheduleType = "Daily" | "Weekly" | "Monthly" | "Yearly" | "Custom";

/** CronJob の追加オプション。 */
export interface CronJobOptions extends CjobCommonOptions {
  /** CronJob のスケジュール。 */
  readonly schedule: ScheduleSyntax;
  /** CronJob のスケジュールタイプ。省略時は Custom。 */
  readonly scheduleType?: ScheduleType;
  /** CronJob の timezone (例: "Asia/Tokyo")。省略時は UTC。 */
  readonly timezone?: string;
  /** CronJob の並行実行ポリシー。省略時は Allow。 */
  readonly concurrencyPolicy?: "Allow" | "Forbid" | "Replace";
  /** 保持する成功した Job の数。省略時は 3。 */
  readonly successfulJobsHistoryLimit?: number;
  /** 保持する失敗した Job の数。省略時は 1。 */
  readonly failedJobsHistoryLimit?: number;
  /** CronJob コントローラが新しい Job を作成する前に待つ秒数。 */
  readonly startingDeadlineSeconds?: number;
  /** CronJob を一時的に停止中にするか。 */
  readonly suspend?: boolean;
}

/** Job 固有のオプション。 */
export interface JobOptions extends CjobCommonOptions {
  /** Job を並行実行するか。省略時は false。 */
  readonly allowConcurrent?: boolean;
  /** ジョブ実行ごとのラベル。 */
  readonly labels?: Record< string, string >;
}

/**
 * CronJob を ArgoCD 経由で管理するための `CronJob` リソースを生成する。
 *
 * cdk8s の `ApiObject` を直接生成する薄いラッパーであり、ArgoCD Application
 * のような中間レイヤーを挟まない。`packages/ns/<namespace>/index.ts` で直接
 * 使うことを想定している。
 */

export function createCronJob(
  chart: Chart,
  applicationName: string,
  options: CronJobOptions,
  containers: readonly CjobContainer[],
): ApiObject {
  if ( containers.length === 0 ) {
    throw new Error( "Containers must not be empty for CronJob." );
  }

  const containersSpec: Record< string, unknown >[] = containers.map( ( c ) => ( {
    name: c.name,
    image: c.image,
    command: c.command,
    args: c.args,
  } ) );

  const spec: Record< string, unknown > = {
    schedule: buildScheduleString( options.schedule, options.scheduleType ),
    jobTemplate: {
      spec: {
        backoffLimit: options.backoffLimit ?? 2,
        template: {
          spec: {
            containers: containersSpec,
            restartPolicy: "Never",
          },
        },
      },
    },
  };

  if ( options.successfulJobsHistoryLimit !== undefined ) {
    spec.successfulJobsHistoryLimit = options.successfulJobsHistoryLimit;
  }
  if ( options.failedJobsHistoryLimit !== undefined ) {
    spec.failedJobsHistoryLimit = options.failedJobsHistoryLimit;
  }
  if ( options.startingDeadlineSeconds !== undefined ) {
    spec.startingDeadlineSeconds = options.startingDeadlineSeconds;
  }
  if ( options.timezone ) {
    spec.timeZone = options.timezone;
  }
  if ( options.concurrencyPolicy ) {
    spec.concurrencyPolicy = options.concurrencyPolicy;
  }
  if ( options.activeDeadlineSeconds !== undefined ) {
    spec.activeDeadlineSeconds = options.activeDeadlineSeconds;
  }

  return new ApiObject( chart, applicationName, {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: {
      name: applicationName,
      namespace: options.namespace,
    },
    spec,
  } );
}

/**
 * Job を ArgoCD 経由で管理するための `Job` リソースを生成する。
 *
 * cdk8s の `ApiObject` を直接生成する薄いラッパーであり、ArgoCD Application
 * のような中間レイヤーを挟まない。`packages/ns/<namespace>/index.ts` で直接
 * 使うことを想定している。
 */

export function createJob(
  chart: Chart,
  applicationName: string,
  options: JobOptions,
  containers: readonly CjobContainer[],
): ApiObject {
  if ( containers.length === 0 ) {
    throw new Error( "Containers must not be empty for Job." );
  }

  const containersSpec: Record< string, unknown >[] = containers.map( ( c ) => ( {
    name: c.name,
    image: c.image,
    command: c.command,
    args: c.args,
  } ) );

  const spec: Record< string, unknown > = {
    backoffLimit: options.backoffLimit ?? 3,
    template: {
      spec: {
        restartPolicy: "Never",
        containers: containersSpec,
      },
    },
  };

  if ( options.activeDeadlineSeconds !== undefined ) {
    spec.activeDeadlineSeconds = options.activeDeadlineSeconds;
  }

  return new ApiObject( chart, applicationName, {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: applicationName,
      namespace: options.namespace,
    },
    spec,
  } );
}

/** POSIX cron 式を構築する。scheduleType に対応する式を返す。 */
function buildScheduleString( schedule: ScheduleSyntax, scheduleType: ScheduleType = "Custom" ): string {
  const formatSchedule = formatTime( schedule.hours, schedule.minutes );
  let cronSyntax = `${ formatSchedule[ 1 ] } ${ formatSchedule[ 0 ] } * * *`;

  switch ( scheduleType ) {
    case "Daily":
      return cronSyntax;
    case "Weekly":
      if ( schedule.weekdays === undefined ) {
        throw new Error( "Weekly で weekdays を指定してください。" );
      }
      cronSyntax = `${ formatSchedule[ 1 ] } ${ formatSchedule[ 0 ] } * * ${ schedule.weekdays }`;
      return cronSyntax;
    case "Monthly":
      if ( schedule.days === undefined || schedule.weekdays === undefined ) {
        throw new Error( "Monthly で days と weekdays を指定してください。" );
      }
      cronSyntax = `${ formatSchedule[ 1 ] } ${ formatSchedule[ 0 ] } ${ schedule.days } * ${ schedule.weekdays }`;
      return cronSyntax;
    case "Yearly":
      if ( schedule.days === undefined || schedule.months === undefined || schedule.weekdays === undefined ) {
        throw new Error( "Yearly で days, months, weekdays を指定してください。" );
      }
      cronSyntax = `${ formatSchedule[ 1 ] } ${ formatSchedule[ 0 ] } ${ schedule.days } ${ schedule.months } ${ schedule.weekdays }`;
      return cronSyntax;
    case "Custom":
      if ( schedule.days !== undefined || schedule.months !== undefined || schedule.weekdays !== undefined ) {
        throw new Error( "Custom で days, months, weekdays は指定できません。" );
      }
      return cronSyntax;
  }
}

/** 時間を 0 埋め 2 桁の文字列にフォーマットする。 */
function formatTime( hours: number, minutes: number ): [ string, string ] {
  const minuteStr = minutes < 10 ? `0${ minutes }` : minutes.toString();
  const hourStr = hours < 10 ? `0${ hours }` : hours.toString();
  return [ minuteStr, hourStr ];
}
