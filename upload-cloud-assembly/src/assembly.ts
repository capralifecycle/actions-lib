/**
 * The pointer a pipeline reads to find the Cloud Assembly it should deploy. The
 * field names are part of the contract with the pipeline, not an internal
 * detail, and they differ from the ones a CDK source metadata file uses.
 */
export interface AssemblyMetadata {
  readonly cloudAssemblyBucketName: string
  readonly cloudAssemblyBucketKey: string
  readonly cloudAssemblyVersionId: string
}

export const buildMetadata = (
  cloudAssemblyBucketName: string,
  cloudAssemblyBucketKey: string,
  cloudAssemblyVersionId: string,
): AssemblyMetadata => ({
  cloudAssemblyBucketName,
  cloudAssemblyBucketKey,
  cloudAssemblyVersionId,
})

export const renderMetadata = (metadata: AssemblyMetadata): string =>
  `${JSON.stringify(metadata, null, 2)}\n`
