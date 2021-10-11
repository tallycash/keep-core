// SPDX-License-Identifier: MIT
pragma solidity ^0.8.6;

library Groups {
    // The index of a group is flagged with the most significant bit set,
    // to distinguish the group `0` from null.
    // The flag is toggled with bitwise XOR (`^`)
    // which keeps all other bits intact but flips the flag bit.
    // The flag should be set before writing to `groupIndices`,
    // and unset after reading from `groupIndices`
    // before using the value.
    uint256 constant GROUP_INDEX_FLAG = 1 << 255;

    struct Group {
        bytes groupPubKey;
        uint256 activationTimestamp;
    }

    struct Data {
        // Mapping of `groupPubKey` to flagged `groupIndex`
        mapping(bytes => uint256) groupIndices;
        Group[] groups;
    }

    /// @notice Adds a new group.
    function addGroup(Data storage self, bytes memory groupPubKey) public {
        // TODO: Check if this is correct, we don't want to duplicate entries
        if (self.groupIndices[groupPubKey] == 0) {
            self.groupIndices[groupPubKey] = (self.groups.length ^
                GROUP_INDEX_FLAG);
            self.groups.push(Group(groupPubKey, 0));
        }
    }

    function activateGroup(Data storage self, bytes memory groupPubKey) public {
        Group storage group = _getGroup(self, groupPubKey);

        require(
            group.activationTimestamp == 0,
            "group with this public key was already activated"
        );

        group.activationTimestamp = block.timestamp;
    }

    function getGroup(Data storage self, bytes memory groupPubKey)
        public
        view
        returns (Group memory)
    {
        return _getGroup(self, groupPubKey);
    }

    function _getGroup(Data storage self, bytes memory groupPubKey)
        private
        view
        returns (Group storage)
    {
        uint256 flaggedIndex = self.groupIndices[groupPubKey];
        require(flaggedIndex != 0, "Group does not exist");

        uint256 index = flaggedIndex ^ GROUP_INDEX_FLAG;

        return self.groups[index];
    }

    // TODO: Add group termination

    /// @notice Gets the number of active groups. Expired and terminated groups are
    /// not counted as active.
    function numberOfGroups(Data storage self) public view returns (uint256) {
        return self.groups.length;
        // TODO: Subtract expired and terminated groups
        // .sub(self.expiredGroupOffset).sub(
        //     self.activeTerminatedGroups.length)
    }
}