import { S3Client } from "@aws-sdk/client-s3"
import { PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm"
import { Upload } from "@aws-sdk/lib-storage"

/**
 * A custom endpoint means S3 is being stood in for, and a stand-in is reached
 * at `<endpoint>/<bucket>` rather than at a per-bucket hostname it has no DNS
 * for. Against real S3 the default virtual-hosted addressing is used.
 */
const usesCustomEndpoint = (): boolean =>
  (process.env["AWS_ENDPOINT_URL_S3"] ?? process.env["AWS_ENDPOINT_URL"] ?? "") !== ""

/**
 * Credentials and region come from the environment, which is how the workflows
 * pass them: `configure-aws-credentials` returns them as step outputs and each
 * step that needs them maps them into its own `env`, rather than leaving them
 * in the environment of every later step in the job.
 */
const s3 = (): S3Client =>
  new S3Client({ forcePathStyle: usesCustomEndpoint() })

export interface PutObjectRequest {
  readonly bucket: string
  readonly key: string
  readonly body: Uint8Array
}

/**
 * Returns the object's version id, for a bucket that has versioning enabled.
 *
 * Uploads in parts, as `aws s3 cp` does: a single PutObject is capped at 5 GB,
 * which is below the size an artifact can legitimately reach.
 */
export async function putObject(
  request: PutObjectRequest,
): Promise<string | undefined> {
  const upload = new Upload({
    client: s3(),
    params: { Bucket: request.bucket, Key: request.key, Body: request.body },
  })
  const result = await upload.done()
  return result.VersionId
}

/** Writes a plain string parameter, replacing any value already there. */
export async function putParameter(name: string, value: string): Promise<void> {
  await new SSMClient({}).send(
    new PutParameterCommand({ Name: name, Value: value, Type: "String", Overwrite: true }),
  )
}
