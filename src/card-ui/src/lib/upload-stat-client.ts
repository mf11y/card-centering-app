export type UploadStatState = { count: number | null; confirmedCreates: number };

export function applyStatsResponse(state: UploadStatState, serverCount: unknown): UploadStatState {
    if (typeof serverCount !== 'number' || !Number.isInteger(serverCount) || serverCount < 0) return state;
    return { ...state, count: serverCount + state.confirmedCreates };
}

export function applyConfirmedCreate(state: UploadStatState): UploadStatState {
    return { count: state.count === null ? null : state.count + 1, confirmedCreates: state.confirmedCreates + 1 };
}
