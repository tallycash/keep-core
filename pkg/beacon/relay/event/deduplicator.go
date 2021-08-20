package event

import (
	"encoding/hex"
	"fmt"
	"sync"
)

// Local chain interface to avoid import cycles.
type chain interface {
	CurrentRequestPreviousEntry() ([]byte, error)
}

// Deduplicator decides whether the given event should be handled by the
// client or not.
//
// Event subscription may emit the same event two or more times. The same event
// can be emitted right after it's been emitted for the first time. The same
// event can also be emitted a long time after it's been emitted for the first
// time. It is deduplicator's responsibility to decide whether the given
// event is a duplicate and should be ignored or if it is not a duplicate and
// should be handled.
//
// Those events are supported:
// - group selection started
// - relay entry requested
type Deduplicator struct {
	chain                           chain
	minGroupSelectionDurationBlocks uint64

	groupSelectionMutex             sync.Mutex
	currentGroupSelectionStartBlock uint64

	relayEntryMutex             sync.Mutex
	currentRequestStartBlock    uint64
	currentRequestPreviousEntry string
}

// NewDeduplicator constructs a new Deduplicator instance.
func NewDeduplicator(
	chain chain,
	minGroupSelectionDurationBlocks uint64,
) *Deduplicator {
	return &Deduplicator{
		chain:                           chain,
		minGroupSelectionDurationBlocks: minGroupSelectionDurationBlocks,
	}
}

// NotifyGroupSelectionStarted notifies the client wants to start group
// selection upon receiving an event. It returns boolean indicating whether the
// client should proceed with the execution or ignore the event as a duplicate.
func (d *Deduplicator) NotifyGroupSelectionStarted(
	newGroupSelectionStartBlock uint64,
) bool {
	d.groupSelectionMutex.Lock()
	defer d.groupSelectionMutex.Unlock()

	minCurrentGroupSelectionEndBlock := d.currentGroupSelectionStartBlock +
		d.minGroupSelectionDurationBlocks

	shouldUpdate := d.currentGroupSelectionStartBlock == 0 ||
		newGroupSelectionStartBlock > minCurrentGroupSelectionEndBlock

	if shouldUpdate {
		d.currentGroupSelectionStartBlock = newGroupSelectionStartBlock
		return true
	}

	return false
}

// NotifyRelayEntryStarted notifies the client wants to start relay entry
// generation upon receiving an event. It returns boolean indicating whether the
// client should proceed with the execution or ignore the event as a duplicate.
func (d *Deduplicator) NotifyRelayEntryStarted(
	newRequestStartBlock uint64,
	newRequestPreviousEntry string,
) (bool, error) {
	d.relayEntryMutex.Lock()
	defer d.relayEntryMutex.Unlock()

	shouldUpdate := func() (bool, error) {
		// If there is no prior relay request registered by this node, return
		// true unconditionally.
		if d.currentRequestStartBlock == 0 {
			return true, nil
		}

		// A valid new relay request should have its block number bigger than
		// the current one because it occurs later for sure.
		if newRequestStartBlock > d.currentRequestStartBlock {
			// There may be a case when new relay request holds the same
			// previous entry than the current one. It is the case when a timed
			// out request is retried. In that case, we must verify the chain
			// state. In contrary, if new relay request holds a different
			// previous entry than the current one, everything is ok.
			if newRequestPreviousEntry == d.currentRequestPreviousEntry {
				currentRequestPreviousEntryOnChain, err := d.chain.
					CurrentRequestPreviousEntry()
				if err != nil {
					return false, fmt.Errorf(
						"could not get current request previous entry: [%v]",
						err,
					)
				}

				if newRequestPreviousEntry ==
					hex.EncodeToString(currentRequestPreviousEntryOnChain[:]) {
					return true, nil
				}
			} else {
				return true, nil
			}
		}

		return false, nil
	}

	update, err := shouldUpdate()
	if err != nil {
		return false, err
	}

	if update {
		d.currentRequestStartBlock = newRequestStartBlock
		d.currentRequestPreviousEntry = newRequestPreviousEntry
		return true, nil
	}

	return false, nil
}
