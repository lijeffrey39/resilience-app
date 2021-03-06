import BaseModel from "./BaseModel";
import {
  Location,
  MissionFundedStatus,
  MissionInterface,
  UserInterface,
  MissionStatus,
  MissionType,
  TimeWindow,
  TimeWindowType,
} from "./schema";
import _ from "lodash";
import Organization from "./Organization";

const defaultLocation: Location = {
  address: "",
  lat: 0,
  lng: 0,
  label: "",
};

const defaultTimeWindow: TimeWindow = {
  startTime: "",
  timeWindowType: TimeWindowType.whenever,
};

type Group = {
  groupUid: string;
  groupDisplayName: string;
  missions: MissionInterface[];
};

const defaultMissionData: MissionInterface = {
  uid: "",
  type: MissionType.errand,
  status: MissionStatus.unassigned,
  createdDate: "",
  missionDetails: null,
  fundedStatus: MissionFundedStatus.notfunded,
  fundedDate: null,
  readyToStart: false,
  organizationUid: "",

  groupUid: "",
  groupDisplayName: "",

  tentativeVolunteerDisplayName: "",
  tentativeVolunteerUid: "",
  tentativeVolunteerPhoneNumber: "",

  volunteerUid: "",
  volunteerDisplayName: "",
  volunteerPhoneNumber: "",

  recipientDisplayName: "No Recipient Name",
  recipientPhoneNumber: "",
  recipientUid: "No Recipient Id", // reference?

  pickUpWindow: defaultTimeWindow, // nb this can be an exact time or can be null
  pickUpLocation: defaultLocation,

  deliveryWindow: defaultTimeWindow,
  deliveryLocation: defaultLocation, // default to recipient location

  deliveryConfirmationImage: "",
  deliveryNotes: "",
  feedbackNotes: "",
};

const fsInProposed = (orgId: string) => ({
  collection: "organizations",
  doc: orgId,
  subcollections: [
    {
      collection: "missions",
      where: [
        ["status", "==", MissionStatus.unassigned],
        ["fundedStatus", "==", MissionFundedStatus.notfunded],
      ],
    },
  ],
  storeAs: "missionsInProposed",
});
const fsInPlanning = (orgId: string) => ({
  collection: "organizations",
  doc: orgId,
  subcollections: [
    {
      collection: "missions",
      where: [["status", "in", [MissionStatus.tentative, MissionStatus.assigned]]],
    },
  ],
  storeAs: "missionsInPlanning",
});
const fsInProgress = (orgId: string) => ({
  collection: "organizations",
  doc: orgId,
  subcollections: [
    {
      collection: "missions",
      where: [["status", "in", [MissionStatus.started, MissionStatus.delivered]]],
    },
  ],
  storeAs: "missionsInProgress",
});
const fsInDone = (orgId: string) => ({
  collection: "organizations",
  doc: orgId,
  subcollections: [
    {
      collection: "missions",
      where: [["status", "in", [MissionStatus.succeeded, MissionStatus.failed]]],
    },
  ],
  storeAs: "missionsInDone",
});
const fsIncomplete = (orgId: string) => ({
  collection: "organizations",
  doc: orgId,
  subcollections: [
    {
      collection: "missions",
      where: [
        [
          "status",
          "in",
          [
            MissionStatus.tentative,
            MissionStatus.assigned,
            MissionStatus.started,
            MissionStatus.delivered,
          ],
        ],
      ],
    },
  ],
  storeAs: "incompleteMissions",
});

const getAllGroups = (missions: MissionInterface[]) => {
  let groups: Group[] = [];
  let singleMissions: MissionInterface[] = [];
  missions.forEach((mission: MissionInterface) => {
    if (mission.groupUid) {
      const index = _.findIndex(groups, ["groupUid", mission.groupUid]);
      if (index > -1) {
        groups[index].missions.push(mission);
      } else {
        groups.push({
          groupUid: mission.groupUid,
          groupDisplayName: mission.groupDisplayName,
          missions: [mission],
        });
      }
    } else {
      singleMissions.push(mission);
    }
  });
  return {
    groups,
    singleMissions,
  };
};

class Mission extends BaseModel {
  collectionName = "missions";
  Status = MissionStatus;
  FundedStatus = MissionFundedStatus;
  TimeWindowType = TimeWindowType;

  selectInProposed = (state: any) => state.firestore.ordered.missionsInProposed || [];
  fsInProposed = fsInProposed;
  selectInPlanning = (state: any) => state.firestore.ordered.missionsInPlanning || [];
  fsInPlanning = fsInPlanning;
  selectInProgress = (state: any) => state.firestore.ordered.missionsInProgress || [];
  fsInProgress = fsInProgress;
  selectInDone = (state: any) => state.firestore.ordered.missionsInDone || [];
  fsInDone = fsInDone;
  selectIncomplete = (state: any) => state.firestore.ordered.incompleteMissions || [];
  fsIncomplete = fsIncomplete;

  getAllGroups = getAllGroups;

  getByUid = async (missionUid: string) => {
    const collection = this.getCollection("organizations")
      .doc(Organization.uid)
      .collection("missions");
    let doc;
    try {
      doc = await collection.doc(missionUid).get();
    } catch (error) {
      //TODO show error message to user
      throw error;
    }

    if (!doc.exists) {
      throw Error(`This mission:  ${missionUid} does not exist`);
    }

    let data = doc.data();

    if (!data) {
      throw Error(`no data for this mission: ${missionUid}`);
    }

    return data;
  };

  /**
   * Returns all available missions.
   * A mission is available if it has a status of "tentative"
   */
  getAllAvailable = () => {
    return this.getCollection("organizations")
      .doc(Organization.uid)
      .collection("missions")
      .where("status", "==", MissionStatus.tentative)
      .get()
      .then((querySnapshot) => {
        return querySnapshot.docs.map((doc) => doc.data());
      });
  };

  /**
   * Update a mision
   * @param {string} missionUid - mission
   * @param {object} data- updated data
   */
  update(missionUid: string, data: object) {
    let sanitized = this.sanitize(data);
    return this.getCollection("organizations")
      .doc(Organization.uid)
      .collection("missions")
      .doc(missionUid)
      .update({
        ...sanitized,
      });
  }

  /**
   * create a new mission
   * returns the new mission id
   * @param {object} mission
   * @return {string}
   */
  create(mission: MissionInterface) {
    // Grab a newly generated doc
    const newRef = this.getCollection("organizations")
      .doc(Organization.uid)
      .collection("missions")
      .doc();

    const newMission = this.load({
      ...mission,
      uid: newRef.id,
      createdDate: Date.now().toString(),
    });

    return newRef.set(newMission).then(() => newMission);
  }

  /**
   * User assigned as tentative for a mission
   * @param {string} userUid : user
   * @param {string} missionUid : mission that user want to volunteer for
   */
  assign(userUid: string, user: UserInterface, missionUid: string) {
    return this.update(missionUid, {
      uid: missionUid,
      tentativeVolunteerUid: userUid,
      tentativeVolunteerDisplayName: user.displayName,
      tentativeVolunteerPhoneNumber: user.phoneNumber,
      volunteerUid: "",
      volunteerDisplayName: "",
      volunteerPhoneNumber: "",
      status: MissionStatus.tentative,
    });
  }
  /**
   * accepts a mission
   * @param {string} userUid : user
   * @param {string} missionUid : mission that user want to volunteer for
   */
  accept(userUid: string, user: UserInterface, missionUid: string) {
    console.log(userUid);
    console.log(missionUid);

    //TODO: rules in db for missions not accepting new volunteer if it already have one
    return this.update(missionUid, {
      uid: missionUid,
      tentativeVolunteerUid: "",
      tentativeVolunteerDisplayName: "",
      tentativeVolunteerPhoneNumber: "",
      volunteerUid: userUid,
      volunteerDisplayName: user.displayName,
      volunteerPhoneNumber: user.phoneNumber,
      status: MissionStatus.assigned,
    });
  }
  /**
   * User start a mission
   * @param {string} userUid - user
   * @param {string} missionUid - mission that user want to start
   */
  start(userUid: string, user: UserInterface, missionUid: string) {
    //TODO: rules in db, only user that are correct assigned can start
    return this.update(missionUid, {
      uid: missionUid,
      tentativeVolunteerUid: "",
      tentativeVolunteerDisplayName: "",
      tentativeVolunteerPhoneNumber: "",
      volunteerUid: userUid,
      volunteerDisplayName: user.displayName,
      volunteerPhoneNumber: user.phoneNumber,
      status: MissionStatus.started,
    });
  }
  /**
   * User deliver a mission
   * @param {string} userUid - user
   * @param {string} missionUid - mission that user deliver
   */
  deliver(userUid: string, user: UserInterface, missionUid: string) {
    //TODO: rules in db, only user that are correct assigned can start
    return this.update(missionUid, {
      uid: missionUid,
      tentativeVolunteerUid: "",
      tentativeVolunteerDisplayName: "",
      tentativeVolunteerPhoneNumber: "",
      volunteerUid: userUid,
      volunteerDisplayName: user.displayName,
      volunteerPhoneNumber: user.phoneNumber,
      status: MissionStatus.delivered,
    });
  }

  /**
   * Volunteer is removed from a mission
   * @param {string} missionUid : mission that user want to volunteer for
   */

  unassigned(missionUid: string) {
    //TODO: rules in db, only user that are in correct organization + is organizer
    return this.update(missionUid, {
      uid: missionUid,
      tentativeVolunteerUid: "",
      tentativeVolunteerDisplayName: "",
      tentativeVolunteerPhoneNumber: "",
      volunteerUid: "",
      volunteerDisplayName: "",
      volunteerPhoneNumber: "",
      status: MissionStatus.tentative,
    });
  }
  filterByStatus = (missions: MissionInterface[], status: MissionStatus) =>
    missions.filter((mission) => mission.status === status);
}

export default new Mission("missions", defaultMissionData);
