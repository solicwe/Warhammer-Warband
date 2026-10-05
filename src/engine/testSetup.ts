// Tests play the plain bot (no lookahead: it plays every bot turn several times over and makes whole games slow);
// the lookahead's own test and the tuner switch it back on.
import { setLookahead } from './botLook';

setLookahead(false);
