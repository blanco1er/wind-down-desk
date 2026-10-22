import { createComponent, Types } from '@iwsdk/core';

/** A worry stone on the desk. `tokenId` links to SortingSession state. */
export const WorryToken = createComponent('WorryToken', {
  tokenId: { type: Types.String, default: '' },
});

/** A pinchable / pokeable desk control: "orb", "keep", "lighter". */
export const DeskButton = createComponent('DeskButton', {
  action: { type: Types.String, default: '' },
});

/** v6 Release: the dark engraved stone that is held over the water and let sink. */
export const WeightStone = createComponent('WeightStone', {
  title: { type: Types.String, default: '' },
});
