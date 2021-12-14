// All code runs in this anonymous function
// to avoid cluttering the global variables
(function() {

/* ============ GLOBAL SECTION ===============
   Most global variables are defined here
   =========================================== */    
  let dataCont = []; //data container, every signal (hit) goes into it
  let portNames = [];
  let minForLog = 0.1;

/* =========== GRAPHS SECTION ================
   Define the Highchart graphs as global 
   variables.
   =========================================== */    

  // Add entry for settings to graph menu 
  let currentChart = null;
  let buttons = Highcharts.getOptions().exporting.buttons.contextButton.menuItems.slice();
  buttons.unshift({
        text: 'Settings...',
        onclick: function () {
          $("#nBins").val( this.nBins );
          $("#minAxis").val( this.min );
          $("#maxAxis").val( this.max );
          if( this.userOptions.yAxis.type == "linear" ) {
            $("#linear").prop("checked",true);
          } else {
            $("#logarithmic").prop("checked",true);
          }
          currentChart = this;
          showModal("settingsModal");
        }
  });

  let chartOptions = {
    chart: {
      type: 'area',
      margin: [30, 25, 50, 80],
      height: 300,
      borderWidth: 1,
      borderColor: 'grey',
      style: { fontSize: '16px' },
    },
    title: {
      text: 'Peak height (mV)',
    },
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'top',
      y: 20,
      layout: 'vertical',
    },
    exporting: {
      buttons: {
        contextButton: {
          menuItems: buttons
        }
      }
    },
    credits: {
      enabled: false
    },
    plotOptions: {
      series: {
        marker: {
          enabled: false
        },
        step: true,
        borderWidth: 1,
      }
    },
    xAxis: {
      title: {
        text: 'peak height (mV)',
        align: "high",
      },
      lineColor: 'grey',
      lineWidth: 1,
      gridLineWidth: 1,
      //min: 0,
      minorTicks: true,
      labels: { style: { fontSize: '12px' } },
    },
    yAxis: {
      title: {
        text: 'number of events',
        align: "high",
      },
      lineColor: 'grey',
      lineWidth: 1,
      labels: { style: { fontSize: '12px' } },
      minorTicks: true,
      maxPadding: 0.10,
      startOnTick: true,
      type: 'linear'
    },
  };

  let amplChart = Highcharts.chart('amplChart', chartOptions);
  amplChart.nBins = 50;
  amplChart.min = 0;
  amplChart.max = 500;

  chartOptions.title.text ='Peak height (ADC)';
  chartOptions.xAxis.title.text ='peak height (ADC)';
  let adcChart = Highcharts.chart('adcChart', chartOptions);
  adcChart.nBins = 100;
  adcChart.min = 0;
  adcChart.max = 1000;

  chartOptions.title.text ='Time between events';
  chartOptions.xAxis.title.text ='&#916;t (s)';
  let dtChart = Highcharts.chart('dtChart', chartOptions);
  dtChart.nBins = 100;
  dtChart.min = 0;
  dtChart.max = 60;

  chartOptions.title.text ='Rate versus time';
  chartOptions.xAxis.title.text ='time (s)';
  chartOptions.yAxis.title.text ='rate (Hz)';
  let rateChart = Highcharts.chart('rateChart', chartOptions);
  rateChart.nBins = 100;
  rateChart.min = 0;
  rateChart.max = 600;

  let charts = { adc: adcChart, ampl: amplChart, 
                 ardTime: rateChart, dt: dtChart };
  for (chartName in charts) {
    charts[chartName].chartName = chartName;
  }


/* ============= MODAL SECTION =================
   Define functions for the modal boxes.
   Shows and hides the modal boxes.
   =========================================== */    
  
  // Showing modal box
  function showModal(name) { $("#"+name).toggle(); }

  // When the user clicks on <span> (x), close the current modal
  $(".close").on("click", function() { $(this).parent().parent().toggle(); });
  
  // When the user clicks anywhere outside of the modal, close it
  $(window).on("click", function(event) {
    if( event.target.className === "modal" ) event.target.style.display = "none";
  });

/* ========== AUDIO SECTION ====================
   Start the audioContext and set the microphone
   ============================================= */

  // Create the AudioContext
  let audioCtx = new (window.AudioContext || window.webkitAudioContext || 
                      window.audioContext);

  // Create the gain node for the buzzer
  let gainNode = null;
  if( audioCtx ) {
    gainNode = audioCtx.createGain();
    gainNode.connect(audioCtx.destination);
  }

  function beep(duration, frequency) {
    let oscillator = audioCtx.createOscillator();      
    if (frequency){oscillator.frequency.value = frequency;}
    oscillator.connect(gainNode);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + ((duration || 500) / 1000));
  }

/* ========== IMPORT SECTION ====================
   Import the data from a local txt-file. 
   ============================================= */

  // When import is clicked (dummy button) trigger input  
  $("#import").click( () => {
    $("#input").val(''); // Resets file input such that it triggers any next change
    $("#input").click(); // Progagate to (hidden) DOM element
  });

  // Read the data from a local txt file 
  $("#input").change( async function() {

    // Set a status message as large files can take a while
    $('#statusMsg').html( "Reading file... <i class='fa fa-spinner fa-spin fa-fw'></i>" );

    // Get the file
    let file = this.files[0]; 

    // Create a new hits container and add to the series
    let i = addData( file.name );

    // Loop over the lines in the text file
    let text = await file.text();
    let textArray = text.split("\n");
    let length = textArray.length;
    for( let j=0; j < length-1; ++j ) {
      processLine( textArray[j], i );
    }
    $("#statusMsg").html("Updating graphs... <i class='fa fa-spinner fa-spin fa-fw'></i>");
    setTimeout(function(){
      updateRate( i );
      addSeriesToCharts( file.name );
      setMaxTimeRateChart( i );
      updateCharts( i );
      $("#logFile_n"+i).val( text );
      $("#statusMsg").html("");
    },0);
  });

/* ========= PREPARE DATA SECTION ==============
   After adding new data, add new data items to 
   the big data container, add column to the 
   summary table.
   ============================================= */

  // Create a new data entry in the big data container
  function addData( name ){
    let index = dataCont.length;
    // Create a new data item and add to the container
    let dataItem = { name: name, device: "", hits: [], header: "",
                     meanAmpl: 0, meanADC: 0, meanTemp: 0,
                     port: null, reader: null, inputDone: null, playSound: false};
    dataCont.push(dataItem);

    // Add an extra column to the summary table
    addColumn( name );

    // Add a textarea to show the log file
    $("#logFiles").append( '<textarea hidden readonly id="logFile_n'+ index 
                            + '" rows="15" cols="100"></textarea>');

    // return the current index
    return index;
  }

  // Add an extra column to the summary table
  function addColumn(name) {
    let iter = dataCont.length-1;
    $('#summaryTable').find('tr').each(function(){
      let row = $(this);
      let content = "";
      if( row.index() === 0 ) { 
        content += '<input id="dataname'+iter+'" style="width: 150px;" value="';
        content += name+ '" ></input>';
        content += '<span title="Remove data" id="remove'+
                    iter+'" class="close">&times;</span>';
      }
      if( this.id == "control" && name.startsWith("usb")) {
        content += '<button title="Play sound on event" id="sound' + iter
                   +'"><i class="fa fa-bell-slash"></i></button>';
        content += '<button title="Stop data taking" id="stop' + iter
                   +'"><i class="fa fa-stop"></i></button>';
        content += '<button title="Export data as text file" id="export' + iter 
                    + '"><i class="fa fa-download"></i></button>';
      }
      if( this.id == "control") {
        content += '<button title="Show/hide raw data" id="showLog'+iter
        +'"><i class="fa fa-eye-slash"></i></button>';
      }
      row.append('<td id="'+this.id+"_n"+iter+'">'+content+'</td>');
    });

    // Add event listeners for the buttons and the data name field
    $("#dataname"+iter).change( function(event) {
      let newName = $(this).val() ;
      for (chartName in charts) {
        let chart = charts[chartName];
        chart.series[iter].update({name:newName}, false);
        chart.redraw();
      }
    });
    $("#sound"+iter).click( function() { 
      $(this).find('.fa-bell-slash,.fa-bell')
        .toggleClass('fa-bell').toggleClass('fa-bell-slash');
      dataCont[iter].playSound = !dataCont[iter].playSound;
    });
    $("#remove"+iter).click( async (event) => { clearData( iter ); });
    $("#stop"+iter).click( async (event) => { stopMeasurement( iter ); });
    $("#export"+iter).click( () => {
      let filename = prompt("Download as...", $("#dataname"+iter).val() + ".txt");
      if (filename != null && filename != "") {
        let url = 'data:text/plain;charset=utf-8,';
        url += encodeURIComponent( getDataAsString(iter) ) ;
        downloadURL( url, filename );
      }
    });
    $("#showLog"+iter).click( function() { 
      $("#logFile_n"+iter).toggle(); 
      $(this).find('.fa-eye-slash,.fa-eye')
        .toggleClass('fa-eye').toggleClass('fa-eye-slash');

    });
  }

  // Remove the data series
  async function clearData( i ) {
    // Clear the port
    if (dataCont[i].port) {
      if (dataCont[i].reader) {
        await dataCont[i].reader.cancel();
        await dataCont[i].inputDone.catch(() => {});
        dataCont[i].reader = null;
        dataCont[i].inputDone = null;
      }
      await dataCont[i].port.close();
      dataCont[i].port = null;
    }

    // Clear data and remove from charts
    dataCont[i].hits = [];
    for (chartName in charts) {
      let chart = charts[chartName];
      chart.series[i].setData([],true,true);
      chart.series[i].update({ showInLegend : false });
    }
    $('#summaryTable').find('td').each(function(){
      if( this.id.endsWith("n"+i) ) $(this).remove();
    });
  }

/* ======= DATA PROCESSING SECTION =============
   Heart of the script. Process the raw data and
   fill the graphs (histograms).
   ============================================= */

  // Process a raw data line and add the hit to the data series
  function processLine( line, iSeries ) {

    let data = dataCont[iSeries];

    // If the line is a comment, add it to the header
    if( line.startsWith("#") ) {
      data.header += line + "\n";
      return;
    } else if ( data.header == "" ) return;

    // After header, if line does not start with a number assume it contains device name
    if( isNaN(line[0]) && data.header != "") {
      //if( line.startsWith("Device") || prevLineWasComment ) {
      data.device = line.split(" ").pop();
      // Add the device name to the data name
      if( data.port ) {
        $("#dataname"+iSeries).val( data.name + "_" + 
                                    data.device );
        $("#dataname"+iSeries).change();
      }
      return;
    }

    // Split the line into different items
    let items = line.split(" ");
    let hitAdded = false;
    let hits = data.hits;

    // TODO: Add more formats...
    // Guess the format
    if( items.length === 9 ) { // With computer time/date
      hits.push( { time:     items[0] + " " + items[1],
                   index:    parseInt(   items[2] ), 
                   ardTime:  parseFloat( items[3] ) ,
                   adc:      parseFloat( items[4] ),
                   ampl:     parseFloat( items[5] ),
                   deadTime: parseFloat( items[6] ),
                   temp:     parseFloat( items[7]) });
      hitAdded = true;
    } else if ( items.length === 6 ) { // Without computer time/date
      hits.push( { time:     getFormattedDate(), 
                   index:    parseInt(   items[0] ), 
                   ardTime:  parseFloat( items[1] ) ,
                   adc:      parseFloat( items[2] ),
                   ampl:     parseFloat( items[3] ),
                   deadTime: parseFloat( items[4] ),
                   temp:     parseFloat( items[5]) });
      hitAdded = true;
    }

    // First hit should have index=1
    if( hits.length == 1 && hits.at(-1).index != 1 ) {
      hits.pop();
      hitAdded = false;
    }

    // update mean values
    if( hitAdded ) {
      if( data.playSound ) beep(10,2500);
      let hit = hits.at(-1);
      let n = hit.index;
      data.meanADC  += (hit.adc  - data.meanADC ) / n;
      data.meanAmpl += (hit.ampl - data.meanAmpl) / n;
      data.meanTemp += (hit.temp - data.meanTemp) / n;
    }

  }

  // Update the summary table
  function updateRate( iSeries ) {
    let dataItem = dataCont[iSeries];
    let lastHit = dataItem.hits.at(-1);
    let nEvents = dataItem.hits.length;    
    let ardTime = ( dataItem.t0 ) ? 
                  (performance.now() - dataItem.t0) : lastHit.ardTime;
    ardTime *= 0.001;
    let deadTime = (lastHit) ? lastHit.deadTime*0.001 : 0.0;

    // only for debugging
    //if( dataCont[iSeries].t0 && lastHit ) {
    //  console.log( "ArdTime-t0= " + (lastHit.ardTime - 1000*ardTime) );
    // }

    let timeHours = ardTime/3600;
    let upTime = ardTime - deadTime;
    let rate = nEvents / upTime;
    let rate_error = Math.sqrt(nEvents) / upTime;
    let significance = (rate_error > 0) ? -Math.floor(Math.log10(rate_error))+1 : 1;
    significance = Math.max(1, Math.min(significance, 99));

    $("#device_n"+iSeries).html( dataItem.device );
    $("#nEvents_n"+iSeries).html( nEvents );
    $("#ardtime_n"+iSeries).html( ardTime.toFixed(3) + " s ("+
                                 timeHours.toFixed(3) + " h)" );
    $("#deadtime_n"+iSeries).html( deadTime.toFixed(3)+ " s" );
    $("#uptime_n"+iSeries).html( upTime.toFixed(3) + " s");
    $("#rate_n"+iSeries).html( rate.toFixed( significance ) + " &#177; " + 
                              rate_error.toFixed( significance ) + " Hz" );
    $("#ampl_n"+iSeries).html( dataItem.meanAmpl.toFixed(1) + " mV ("+
                                dataItem.meanADC.toFixed(1) + " ADC)" );
    $("#temp_n"+iSeries).html( dataItem.meanTemp.toFixed(1) + " &#8451;");
  }

  // Get the data in a formatted string
  function getFormattedDate() {
    let d = new Date();
    let str = d.getFullYear() + "-" 
    + ('0' + (d.getMonth()+1)).slice(-2) 
    + "-" + ('0' + d.getDate()).slice(-2) + " " 
    + ('0' + d.getHours()).slice(-2) + ":" 
    + ('0' + d.getMinutes()).slice(-2) + ":" 
    + ('0' + d.getSeconds()).slice(-2) + "."
    + ('00' + d.getMilliseconds()).slice(-3);
    return str;
  }

/* ========== USB SERIAL SECTION ===============
   Get the data from an live USB feed.
   ============================================= */

  // Event listener for connecting to serial port
  $("#connect").click( async () => {

    if( 'serial' in navigator ) {
      try {
        let port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });

        let signals = await port.getSignals();
        let portName = "usb"+portNames.length;
        portNames.push(portName);
        let i = addData( portName );
        dataCont[i].port = port;
        // Set the t0. 1600 ms is the startup time for the CosmicWatch arduino
        dataCont[i].t0 = performance.now() + 5150; 
        addSeriesToCharts( portName );
        startMeasurement( i );
      }
      catch (err) {
        console.error('There was an error opening the serial port:', err);
      }
    } else {
      // TODO: This is not true for Chrome...
      console.error('Web serial doesn\'t seem to be enabled in your browser.'+
                    ' Try enabling it by visiting:');
      console.error('chrome://flags/#enable-experimental-web-platform-features');
      console.error('opera://flags/#enable-experimental-web-platform-features');
      console.error('edge://flags/#enable-experimental-web-platform-features');
    }
  });

  // Start the live feed of USB serial data
  async function startMeasurement( i ) {

    if( !dataCont[i].port ) return;

    // Open the stream
    // See https://codelabs.developers.google.com/codelabs/web-serial/#3
    let decoder = new TextDecoderStream();
    dataCont[i].inputDone = dataCont[i].port.readable.pipeTo(decoder.writable);
    dataCont[i].reader = decoder.readable.getReader();

    setTimeout( startUpdating, 1000, i);

    $("#logFile_n"+i).val( "" ) ;
    let stream = "";
    while (true) {
      const { value, done } = await dataCont[i].reader.read();
      if (value) {
        stream += value;

        // Process the stream when a carriage return is found
        let lines = stream.split("\n");
        for( let k=0; k<lines.length-1; ++k ) {
          let line = lines[k];
          $("#logFile_n"+i).val( $("#logFile_n"+i).val() + line + "\n" ) ;
          $("#logFile_n"+i).scrollTop( $("#logFile_n"+i)[0].scrollHeight ) ;
          if( line.startsWith("1 ") ) { // reset when first event is encountered
            dataCont[i].hits = [];
            updateCharts( i );
            dataCont[i].meanADC = dataCont[i].meanAmpl = dataCont[i].meanTemp = 0.0;
          }

          processLine( line, i );
            
          // only for debugging
          /*if( dataCont[i].hits.length != 0 ) {
              let lastHit = dataCont[i].hits.at(-1);
              let ardTime = (performance.now() - dataCont[i].t0);
              console.log( "ArdTime-t0= " + (lastHit.ardTime - ardTime) );
          }*/
        }
        stream = lines.at(-1);
      }
      if (done) {
        console.log('[readLoop] DONE', done);
        dataCont[i].reader.releaseLock();
        break;
      }
    }
  }

  // Recursive updating function for the live feed (every second)
  async function startUpdating( i ) {
    updateRate( i );
    addHitToCharts( i );
    if( dataCont[i].reader ) setTimeout( startUpdating, 1000, i);
  }

  // Stop the updating function for the live feed
  async function stopMeasurement( i ) {
    if (dataCont[i].reader) {
      await dataCont[i].reader.cancel();
      await dataCont[i].inputDone.catch(() => {});
      dataCont[i].reader = null;
      dataCont[i].inputDone = null;
    }
    return;
  }

/* ========== EXPORT SECTION ====================
   Export the data to a txt file in the standard
   CosmicWatch format.
   ============================================= */

  // Format the data
  function getDataAsString( iter ) {
    let dataString = dataCont[iter].header;
    dataString += "Device ID: " + dataCont[iter].device + "\n";
    
    for( let i=0; i<dataCont[iter].hits.length; ++i ) {
      let hit = dataCont[iter].hits[i];
      dataString += hit.time + " " + hit.index + " " + hit.ardTime + " " +
                  hit.adc + " " + hit.ampl +  " " + hit.deadTime + " " +
                  hit.temp + "\n";
    }
    return dataString;       
  }

  // Create (temporarily) a downloadable element
  function downloadURL( url, fileName ) {
    var link = document.createElement("a");
    document.body.appendChild(link); // for Firefox
    link.setAttribute("href", url);
    link.setAttribute("download", fileName );
    link.click();
    document.body.removeChild(link);
  }

/* ============ CHARTS SECTION =================
   Add the data to the graphs (histograms).
   ============================================= */

  // Add empty (new) data all charts
  function addSeriesToCharts( name ) {
    for (chartName in charts) {
      let chart = charts[chartName];
      let min = chart.min;
      let max = chart.max;
      let num_bins= chart.nBins; 

      // Fix bug in Highcharts to support 0 in logarithmic plots
      let initialValue = 0.0;
      if( chart.userOptions.yAxis.type == "logarithmic") initialValue = minForLog;
      let binswithx = []; //with x positions of bins
      for (k=0;k<num_bins;k++){
        binswithx[k]=[(k+0.5)*(max-min)/num_bins+min, initialValue ];
      }
      chart.addSeries({
        name: name,
        data: binswithx,
        nEvents: 0
      });
    }
    return amplChart.series.length-1;
  }

  // Add the missing hits from a single data series to all charts
  function addHitToCharts( iSeries ) {

    for (chartName in charts) {
      let chart = charts[chartName];
      let data = chart.series[iSeries].data;
      let min = chart.min;
      let max = chart.max;
      for( let i=chart.series[iSeries].nEvents; i<dataCont[iSeries].hits.length; ++i ) {
        let hits = dataCont[iSeries].hits;
        let val = hits[i][chartName];
        if( chartName == "ardTime" ) val *= 0.001; // convert to seconds
        else if( chartName == "dt" ) {
          if( i===0 ) val = 0.001*hits[i].ardTime;
          else val = 0.001*(hits[i].ardTime - hits[i-1].ardTime);
        }
        let ibin = Math.floor(((val-min)/(max-min))*(chart.nBins-1));
        if( ibin < 0 || ibin >= chart.nBins ) continue;

        let increment = 1;
        if( chartName == "ardTime") increment = chart.nBins/(max-min);

        data[ibin].update({y : data[ibin].y+increment});
      }
      chart.series[iSeries].nEvents = dataCont[iSeries].hits.length;
    }
    return;
  }

  // Set the maximum x-value to the last time
  function setMaxTimeRateChart( iSeries ) {
    let hits = dataCont[iSeries].hits;

    // set the maximum time to the last hit 
    if( hits.length != 0 ) {
      rateChart.max = 0.001*hits[hits.length-1].ardTime;
    }    
  }

  // Update the all charts with the data series
  function updateCharts( iSeries ) {
    for (chartName in charts) {
      updateChart( charts[chartName], iSeries );
    }
  }

  // Update a single chart with the data series
  function updateChart( chart, iSeries ) {

    if( chart.series[iSeries].data.length == 0 ) return; // data was removed

    let hits = dataCont[iSeries].hits;

    let min = chart.min;
    let max = chart.max;
    let num_bins = chart.nBins;
    let bins = [];
    for (var k=0;k<num_bins;k++){
      bins[k]=0.0;
    }

    let chartName = chart.chartName;
    for (var i=0;i<hits.length;i++){
      let val = hits[i][chartName];
      if( chartName == "ardTime" ) val *= 0.001; // convert to seconds
      else if( chartName == "dt" ) {
        if( i===0 ) val = 0.001*hits[i].ardTime;
        else val = 0.001*(hits[i].ardTime - hits[i-1].ardTime);
      }
      let ibin = Math.floor(((val-min)/(max-min))*(num_bins-1));
      if( ibin < 0 || ibin >= num_bins ) continue;

      if( chartName == "ardTime") bins[ibin] += num_bins/(max-min);
      else bins[ibin] += 1;
    }

    let logarithmic = (chart.userOptions.yAxis.type == "logarithmic");
    let binswithx = [];//with x positions of bins
    for (k=0;k<num_bins;k++){
      // Fix bug in Highcharts to support 0 in logarithmic plots
      if( bins[k] === 0.0 && logarithmic ) bins[k] = minForLog;
       
      binswithx[k]=[min+(k+0.5)*(max-min)/num_bins, bins[k]];
    }

    chart.series[iSeries].setData(binswithx, true, true);
    chart.series[iSeries].nEvents = hits.length;
  }

  // Update charts with the new settings
  $("#applySettings").click( function() {
    let loglinear = $("#linear").prop("checked") ? "linear" : "logarithmic";
    currentChart.update( { yAxis : {type: loglinear } } );

    currentChart.nBins = parseFloat($("#nBins").val());
    currentChart.min = parseFloat($("#minAxis").val());
    currentChart.max = parseFloat($("#maxAxis").val());
    for( let i=0; i<dataCont.length; ++i) {
      updateChart( currentChart, i ); 
    }
  });

})();
