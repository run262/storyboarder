import React, { useState, useMemo, useRef, useCallback } from 'react'
import { connect } from 'react-redux'
import * as THREE from 'three'

import { machineIdSync } from 'node-machine-id'
import pkg from '../../../../../../package.json'
import request from 'request'
import {
  updateObject,
  createPosePreset,
  getSceneObjects,
  getSelections,
  undoGroupStart,
  undoGroupEnd,
  updateCharacterIkSkeleton
} from '../../../../shared/reducers/shot-generator'

import defaultPosePresets from '../../../../shared/reducers/shot-generator-presets/poses.json'
import presetsStorage from '../../../../shared/store/presetsStorage'

import { comparePresetNames, comparePresetPriority } from '../../../utils/searchPresetsForTerms' 
import { NUM_COLS, ITEM_HEIGHT, CHARACTER_MODEL } from '../../../utils/InspectorElementsSettings'
import Modal from '../../Modal'
import { filepathFor } from '../../../utils/filepathFor'
import deepEqualSelector from './../../../../utils/deepEqualSelector'
import PosePresetInspectorItem from './PosePresetInspectorItem'
import SearchList from '../../SearchList/index.js'
import Grid from '../../Grid'
import Scrollable from '../../Scrollable';
import { useAsset } from '../../../hooks/use-assets-manager'
import PostureComponent from './PostureComponent'
const defaultPostureValue = 0.5
const shortId = id => id.toString().substr(0, 7).toLowerCase()

const getAttachmentM = deepEqualSelector([(state) => state.attachments], (attachments) => { 
    let filepath = filepathFor(CHARACTER_MODEL)
    return !attachments[filepath] ? undefined : attachments[filepath].status
})
const PosePresetsEditor = connect(
  state => ({
    attachmentStatus: getAttachmentM(state),
    posePresets: state.presets.poses,
    id: getSelections(state)[0],
    characterPath: filepathFor(CHARACTER_MODEL)
  }),
  {
    updateObject,
    createPosePreset,
    undoGroupStart,
    undoGroupEnd,
    updateCharacterIkSkeleton,
    withState: (fn) => (dispatch, getState) => fn(dispatch, getState())
  }
)(
React.memo(({
  id,

  posePresets,
  characterPath,
  updateObject,
  createPosePreset,
  undoGroupStart,
  undoGroupEnd,
  updateCharacterIkSkeleton,
  withState
}) => {
  const thumbnailRenderer = useRef()

  const sortedAttachament = useRef([])
  const {asset: attachment} = useAsset(characterPath)

  const [results, setResult] = useState([])
  const [isModalShown, showModal] = useState(false)
  const newPresetName = useRef('')
  const newGeneratedId = useRef()
  const postureData = useRef({})

  const presets = useMemo(() => {
    if(!posePresets) return
    let sortedPoses = Object.values(posePresets).sort(comparePresetNames).sort(comparePresetPriority)
    sortedAttachament.current = sortedPoses.map((preset, index) => {
      return {
        value: preset.name + "|" + preset.keywords,
        id: index
      }
    })
    setResult(sortedPoses)
    return sortedPoses
  }, [posePresets])

  const getPosePresetId = () => {
    let posePresetId
    withState((dispatch, state) => {
      posePresetId = getSceneObjects(state)[id].posePresetId
    })
    return posePresetId
  }

  const saveFilteredPresets = useCallback(filteredPreset => {
    let objects = []
    for(let i = 0; i < filteredPreset.length; i++) {
      objects.push(presets[filteredPreset[i].id])
    }
    setResult(objects)
  }, [presets])

  const onCreatePosePreset = event => {
    event.preventDefault()
    newGeneratedId.current = "Pose "+shortId(THREE.Math.generateUUID())
    newPresetName.current = newGeneratedId.current
    showModal(true)
  }

  const addNewPosePreset = (name) => {
    if (name != null && name != '' && name != ' ') {
      withState((dispatch, state) => {
        // get the latest skeleton data
        let sceneObject = getSceneObjects(state)[id]
        let skeleton = sceneObject.skeleton
        let model = sceneObject.model

        let newSkeleton = {}
        let keys = Object.keys(skeleton)
        for(let i = 0; i < keys.length; i++) {
          let key = keys[i]
          let currentBone = skeleton[key]
          newSkeleton[key] = {}
          newSkeleton[key].rotation = { ...currentBone.rotation }
          newSkeleton[key].name = currentBone.name
          newSkeleton[key].id = currentBone.id
        }
        // create a preset out of it
        let newPreset = {
          id: THREE.Math.generateUUID(),
          name,
          keywords: name, // TODO keyword editing
          state: {
            skeleton: newSkeleton || {}
          },
          priority: 0
        }

        // add it to state
        createPosePreset(newPreset)

        // save to server
        // for pose harvesting (maybe abstract this later?)
        request.post('https://storyboarders.com/api/create_pose', {
          form: {
            name: name,
            json: JSON.stringify(newSkeleton),
            model_type: model,
            storyboarder_version: pkg.version,
            machine_id: machineIdSync()
          }
        })

        undoGroupStart()
        // select the preset in the list
        updateObject(id, { posePresetId: newPreset.id })
        undoGroupEnd()
        // get updated state (with newly created pose preset)
        withState((dispatch, state) => {
          // ... and save it to the presets file
          let denylist = Object.keys(defaultPosePresets)
          let filteredPoses = Object.values(state.presets.poses)
            .filter(pose => denylist.includes(pose.id) === false)
            .reduce(
              (coll, pose) => {
                coll[pose.id] = pose
                return coll
              },
              {}
            )
          presetsStorage.savePosePresets({ poses: filteredPoses })
        })
      })
    }
  }
  const limbsSide = (limbName) => {
    let currentSide, oppositeSide
    if(limbName.includes("Left")) {
      currentSide = "Left"
      oppositeSide = "Right"
    } else {
      currentSide = "Right"
      oppositeSide = "Left"
    }
    return {currentSide, oppositeSide}
  }


  const mirrorSkeleton = () => {
    let sceneObject
    withState((dispatch, state) => {
      sceneObject = getSceneObjects(state)[id]
    })
    let oppositeSkeleton = []
    let originalSkeleton = sceneObject.skeleton
    let keys = Object.keys(originalSkeleton)
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i]
      let boneName = key
      let boneRot = originalSkeleton[key].rotation
      let position = originalSkeleton[key].position
      let mirroredQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(boneRot.x, boneRot.y, boneRot.z))
      mirroredQuat.x *= -1
      mirroredQuat.w *= -1
      if(key.includes("Left") || key.includes("Right")) {
        let {currentSide, oppositeSide} = limbsSide(boneName)
        boneName = boneName.replace(currentSide, oppositeSide)
      }
      let euler = new THREE.Euler().setFromQuaternion(mirroredQuat)
      oppositeSkeleton.push({
        id: originalSkeleton[boneName].id,
        name: boneName, 
        rotation : { x: euler.x, y: euler.y, z: euler.z },
        position: { x: position.x, y: position.y, z: position.z }
      })
    }
    updateCharacterIkSkeleton({id:sceneObject.id, skeleton: oppositeSkeleton})
  }

  return (
    <React.Fragment>
    <Modal visible={ isModalShown } onClose={() => showModal(false)}>
      <div style={{ margin:"5px 5px 5px 5px" }}>
        Select a Preset Name:
      </div>
      <div className="column" style={{ flex: 1 }}> 
        <input 
          className="modalInput"
          type="text" 
          placeholder={ newGeneratedId.current }
          onChange={ (value) => newPresetName.current = value.currentTarget.value }/>
      </div>
      <div className="skeleton-selector__div">
        <button
          className="skeleton-selector__button"
          onClick={() => {
            showModal(false)
            addNewPosePreset(newPresetName.current)
          }}>
            Proceed
        </button>
      </div>
   </Modal>
   <div className="thumbnail-search column">
      <div className="row" style={{ padding: "6px 0" } }> 
        <SearchList label="Search for a pose …" list={ sortedAttachament.current } onSearch={ saveFilteredPresets }/>
        <div className="column" style={{ marginLeft: 5 }}> 
          <a className="button_add" href="#"
            style={{ width: 30, height: 34 }}
            onPointerDown={ onCreatePosePreset }
          >+</a>
        </div>
      </div> 
      <div className="mirror_button__wrapper">
        <div className="mirror_button" onPointerDown={ mirrorSkeleton }>Mirror pose</div>
      </div>
      <PostureComponent
        id={ id }
        withState={ withState }
        updateObject={ updateObject }
        getSceneObjects={ getSceneObjects }
        data={postureData.current}
        defaultPostureValue={ defaultPostureValue }
      />

      <Scrollable>
       <Grid
          itemData={{
            presets: results,

            id: id,
            posePresetId: getPosePresetId(),
            resetPosture: () => { postureData.current.setPostureValue(defaultPostureValue) },
            attachment,
            updateObject,
            thumbnailRenderer,
            undoGroupStart,
            undoGroupEnd,
          }}
          Component={PosePresetInspectorItem}
          elements={results}
          numCols={NUM_COLS}
          itemHeight={ITEM_HEIGHT}
       />
      </Scrollable>
    </div> 
    </React.Fragment>
  )
}))

export default PosePresetsEditor
