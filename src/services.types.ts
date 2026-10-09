export interface PowerBiErrorInfo {
  key: string
  value: string | number | undefined
}

export interface PowerBiError {
  message?: string
  detailedMessage?: string
  technicalDetails?: {
    errorInfo?: PowerBiErrorInfo[]
  }
}
