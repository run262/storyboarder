import React, {useCallback} from 'react'

import {remote} from 'electron'
const {dialog} = remote

const FileInput = React.memo(({value = "(none)", label, onChange, wrapperClassName="input-group", refClassName="file-input", ...props}) => {
  const onFileSelect = useCallback((e) => {
    e.preventDefault()
    if (!onChange) {
      return false
    }
    
    let filepaths = dialog.showOpenDialog(null, {})
    
    if (filepaths) {
      let filepath = filepaths[0]
      onChange({file: filepath})
    } else {
      onChange({file: undefined})
    }
    
    // automatically blur to return keyboard control
    document.activeElement.blur()
  }, [onChange])
  
  return (
      <div className={ wrapperClassName }>
        {label ? <div className="input-group__label">{label}</div> : null}
        <div
            className={ refClassName }
            onClick={ onFileSelect }
        >
          <a
            href="#"
            {...props}
          >
            {value}
          </a>
        </div>
      </div>
  )
})

export default FileInput
