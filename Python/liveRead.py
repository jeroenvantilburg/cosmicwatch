import numpy as np
import datetime as datetime
from os import listdir
from os.path import isfile, join
import serial
import serial.tools.list_ports
import time
import requests
#import json
import os
import csv
import copy
from PyQt5 import QtCore
import pyqtgraph as pg

windowMax = False
homeDir = ""#"/home/cosmic/CosmicReadout/"
dataPath = homeDir + "dataFiles/"
verbose = True
spaceFileName = homeDir + "spaceWeather.txt"
spaceWeatherInterval = 600    # should become every 10 min = 600 s 
weatherLocation = "Almere"
weatherInterval = 600    # should become every 10 min = 600 s 
weatherFileName = homeDir + "weather.txt"
weatherUrl = "https://weerlive.nl/api/weerlive_api_v2.php?key=demo&locatie=Amsterdam"
windowWidth = 1200
windowHeight = 630

# See: https://stackoverflow.com/questions/33046733/force-requests-to-use-ipv4-ipv6/46972341#46972341
requests.packages.urllib3.util.connection.HAS_IPV6 = False

pg.setConfigOption('background', 'w')
pg.setConfigOption('foreground', 'k')

def mylinspace(start, end, steps):
  delta = (end - start) / (steps-1)
  increments = range(0, steps) * np.array([delta]*steps)
  return start + increments

def shift(xs, value = 0):
    e = np.empty_like(xs)
    e[-1] = value
    e[:-1] = xs[1:]
    return e

def getPorts() :
    ports = []
    for port in serial.tools.list_ports.comports() :
        if "Bluetooth" in port.device : continue
        ports.append( port )
    return ports

warningAlreadyPrinted = False
def updatePorts( ports, outputDataFiles ) :
    global warningAlreadyPrinted
    availablePorts = getPorts()
    # remove any disconnected ports
    for id in list(ports.keys()) :
        if not any( p.device == ports[id].port for p in availablePorts ) :
            outputDataFiles[id].close()
            del outputDataFiles[id]
            del ports[id]
    # Wait for a port to be connected
    if len(availablePorts) == 0 and not warningAlreadyPrinted :
        print("No Cosmic Watch detected. Connect a muon detector via USB.")
        warningAlreadyPrinted = True
    # loop over available ports and add missing ports
    for availablePort in availablePorts :
        warningAlreadyPrinted = False
        portName = availablePort.device
        if any( p.port == portName for p in ports.values() ) : continue
        print("Cosmic Watch detected at port " + portName)
        port = serial.Serial(portName, baudrate = 9600 )
        port.dtr = False
        time.sleep(1)
        port.reset_input_buffer()
        port.dtr = True
        deviceID = ""
        header = []
        while deviceID == "" :
            if port.in_waiting :
                line = str(port.readline(),'ascii')
                header += [line]
                deviceID = processHeader( line ) #.rstrip('\r\n') )
        # store header in new datafile
        dirFiles = [f for f in listdir(dataPath) if f.startswith(deviceID) and
                     isfile(join(dataPath, f))]
        dirFiles.sort()
        seqNumber = "000000"
        if len(dirFiles) != 0 :
            seqNumber = dirFiles[-1].lstrip(deviceID+"_").rstrip(".txt") 
        seqNumber = "{:06d}".format(int(seqNumber)+1) # add one
        outputFileName = dataPath + deviceID + "_" + seqNumber + ".txt"
        outputFile = open( outputFileName, "a")
        outputFile.writelines( header )
        outputFile.flush()
        # Save the ports and outputFiles as dictionaries
        outputDataFiles[deviceID] = outputFile
        ports[deviceID] = port
    return ports

class ColorCycler :
   def __init__(self) :
      self.index = 0
      self.colors = ['r','#008800', 'b','k']
   def reset(self) :
      self.index = 0
   def color(self) :
      if self.index >= len(self.colors) : self.index = 0
      color = self.colors[self.index]
      self.index += 1
      return color

class histoData :
    def __init__(self, win, xtitle, ytitle, start=0, stop=100, nbins=50) :
        style = {"verSpacing": -5, "brush": (255,255,255,125)}
        win.addLegend(offset=(1,1), **style ) 
        self.isTimeAxis = isinstance(start, datetime.datetime)
        self.win = win
        self.cycler1 = ColorCycler()
        self.cycler2 = ColorCycler()
        self.xtitle = xtitle
        self.ytitle = ytitle
        self.bins = mylinspace(start, stop, nbins+1)
        self.counts = {}
        self.histos = {}
        self.xLine = {}
        self.yLine = {}
        self.graphs = {}
        self.plot()
    def addBin(self) :
        delta = self.bins[1]-self.bins[0]
        self.bins = shift( self.bins, self.bins[-1]+delta )
        for id, counts in self.counts.items() :
            self.counts[id] = shift(counts)
        if self.isTimeAxis : 
            self.win.setXRange(self.bins[0].timestamp(),self.bins[-1].timestamp())
    def addEntries(self, x, id) :
        counts = np.histogram( x, bins=self.bins )[0]
        width = self.bins[1] - self.bins[0]
        xValues = [i+0.5*width for i in self.bins[:-1]]
        if self.isTimeAxis :
            width = self.bins[1].timestamp() - self.bins[0].timestamp()
            xValues = [i.timestamp()+0.5*width for i in self.bins[:-1]]
        if id in self.counts :
            self.counts[id] += counts
            self.histos[id].setOpts(x=xValues, height=self.counts[id])
        else :
            self.counts[id] = counts
            color = self.cycler1.color()
            self.histos[id] = pg.BarGraphItem(x=xValues, height=counts, 
                                              width=width, 
                                              pen=color, brush=color, name=id)
            self.histos[id].setOpacity(0.5)
            self.win.addItem( self.histos[id] )
    def addLineData(self, x, y, id) :
        xValues = [xVal for xVal in x]
        if self.isTimeAxis : xValues = [xVal.timestamp() for xVal in x]
        maxYValue = self.win.getAxis("left").range[1]
        if id in self.xLine :
            self.xLine[id] += xValues
            self.yLine[id] += y
            yValues = [yVal*maxYValue for yVal in self.yLine[id]]
            self.graphs[id].setData(self.xLine[id], yValues)
        else :
            color=self.cycler2.color()
            self.xLine[id] = copy.copy(xValues)
            self.yLine[id] = copy.copy(y)
            yValues = [yVal*maxYValue for yVal in self.yLine[id]]
            self.graphs[id] = pg.PlotDataItem(x=self.xLine[id],y=yValues, name=id,
                                              pen=pg.mkPen(color,width=3))
            self.win.addItem( self.graphs[id] )
    def plot(self) :
        win = self.win
        win.setDefaultPadding(0)
        if self.isTimeAxis : 
            win.setXRange(self.bins[0].timestamp(),self.bins[-1].timestamp())
            axis = pg.DateAxisItem(orientation='bottom')
            win.setAxisItems({"bottom": axis})
        win.showGrid(x=True,y=True)
        styles = {"color": "black", "font-size": "14px"}
        win.setLabel("left", self.ytitle, **styles)
        win.setLabel("bottom", self.xtitle, **styles)
        win.show()

def hour_rounder(t):
    return t.replace(second=0, microsecond=0, minute=0, hour=t.hour+1)
def days_rounder(t):
    return t.replace(second=0, microsecond=0, minute=0, hour=0, day=t.day+1)

def processHeader( line ) :
    if line.startswith("#") : return ""
    if line.startswith("Device ID") :
        print("   " + line, end="")
        return line.strip("Device ID: ").strip("\r\n")

def processLine( line, data ) :
    dataItems = line.rstrip("\r\n").split(" ")
    # check length data items.
    if len(dataItems) > 6 :
        timestamp = dataItems[0] + " " + dataItems[1]
        timestamp = datetime.datetime.strptime( timestamp, "%Y-%m-%d %H:%M:%S.%f" )
        timestamp = timestamp.replace(tzinfo=datetime.timezone.utc)
        nEvt = int(dataItems[2])
        ardTime = float(dataItems[3])
        adc = int(dataItems[4])
        deadTime = float(dataItems[6])
        temp = float(dataItems[7])
    else :
        timestamp = datetime.datetime.now(datetime.timezone.utc) # UTC time is stored
        nEvt = int(dataItems[0])
        ardTime = float(dataItems[1])
        adc = int(dataItems[2])
        deadTime = float(dataItems[4])
        temp = float(dataItems[5])
        strTime=datetime.datetime.strftime( timestamp, "%Y-%m-%d %H:%M:%S.%f" )[:-3] 
        line = strTime + " " + line
    data["datetimes"].append( timestamp.astimezone().replace(tzinfo=None) )  # plot local time (naive)
    data["nEvt"].append(nEvt)
    data["adc"].append(adc)
    data["uptime"].append(0.001*(ardTime - deadTime))
    data["temp"].append(temp)
    return line

pg_layout = pg.GraphicsLayoutWidget()
pg_layout.resize(windowWidth, windowHeight)
plot1 = pg_layout.addPlot(row=0, col=0)#, colspan=2)
plot2 = pg_layout.addPlot(row=0, col=1)
plot3 = pg_layout.addPlot(row=1, col=1)
if windowMax : pg_layout.showMaximized()
else : pg_layout.show()

now = hour_rounder(datetime.datetime.now()) 
then = now - datetime.timedelta(hours=24)
nowD = days_rounder(datetime.datetime.now()) 
thenD = nowD - datetime.timedelta(days=30)

hRateH = histoData(plot1,"last 24 hours", "number of events", then, now, 24)
hRateD = histoData(plot2,"last 30 days", "number of events", thenD, nowD, 30)
hADC   = histoData(plot3,"peak height (ADC)", "number of events", 0, 1024, 24)

dataFiles = [f for f in listdir(dataPath) if isfile(join(dataPath, f))]
for dataFile in dataFiles :
    print("Opening " + dataFile, end="")
    f = open(dataPath + dataFile, "r")
    deviceID = ""
    for line in f :
        deviceID = processHeader( line )
        if deviceID != "" : break
    data = {"datetimes" : [], "nEvt":[], "adc": [], "uptime": [], "temp" : [] }
    for line in f: # Process the data
        processLine( line, data ) 
    f.close()

    hRateH.addEntries( data["datetimes"], deviceID )
    hRateD.addEntries( data["datetimes"], deviceID )
    hADC.addEntries( data["adc"], deviceID )

def scaleTemperature(temperature) : # scale between 0 and 1
    return (temperature+15.)/50.
def scalePressure(pressure) : # scale between 0 and 1
    return (pressure-960.)/100.
def scaleSolarWind(speed) :
    return (speed-200.)/600.
def scaleKpIndex(kp) :
    return kp / 10.

# Plot the weather data in the files
weatherData = []
if isfile(weatherFileName) :
    with open(weatherFileName, 'r') as file :
        csv_reader = csv.DictReader(file, delimiter=' ')
        weatherData = [row for row in csv_reader]
temperature = []
pressure = []
timeStamps = []
for w in weatherData :
    unixTime = int(w["timestamp"])
    localTime = datetime.datetime.fromtimestamp(unixTime, datetime.timezone.utc ).astimezone()
    timeStamps.append( localTime )
    temperature.append( scaleTemperature(float(w["temp"])) ) 
    pressure.append( scalePressure(float(w["luchtd"]) ) )
hRateH.addLineData(timeStamps, temperature, "temperature")
hRateH.addLineData(timeStamps, pressure, "pressure")
hRateD.addLineData(timeStamps, temperature, "temperature")
hRateD.addLineData(timeStamps, pressure, "pressure")

# Plot the space weather data in the files
spaceWeatherData = []
if isfile(spaceFileName) :
    with open(spaceFileName, 'r') as file :
        csv_reader = csv.DictReader(file, delimiter=' ')
        spaceWeatherData = [row for row in csv_reader]
speeds = []
kpIndices = []
timeStamps = []
for s in spaceWeatherData :
    utcTime = datetime.datetime.strptime(s["time_tag"], '%Y-%m-%d %H:%M:%S.%f')
    localTime = utcTime.replace(tzinfo=datetime.timezone.utc).astimezone()
    timeStamps.append( localTime )
    speeds.append( scaleSolarWind(float(s["speed"])) ) 
    kpIndices.append( scaleKpIndex(float(s["Kp"]) ) )
hRateH.addLineData(timeStamps, speeds, "speed")
hRateH.addLineData(timeStamps, kpIndices, "kp")
hRateD.addLineData(timeStamps, speeds, "speed")
hRateD.addLineData(timeStamps, kpIndices, "kp")


def getJSON(url) :
    r = None
    try:
        r = requests.get(url, timeout=4)
        r.raise_for_status()
    except requests.exceptions.RequestException as err:
        print ("Http error: ",err)
        return []
    json = r.json()
    return json

def getLiveWeather() :
    weatherJson = getJSON( weatherUrl )
    if len( weatherJson ) == 0 : return 0, 0
    #print( weatherJson )
    liveWeather = weatherJson["liveweer"][0]
    liveWeather.pop("verw"); liveWeather.pop("image");liveWeather.pop("alarm")
    liveWeather.pop("lkop");liveWeather.pop("ltekst");liveWeather.pop("wrschklr")
    liveWeather.pop("wrsch_g");liveWeather.pop("wrsch_gts");liveWeather.pop("wrsch_gc")
    temperature = liveWeather["temp"]
    pressure = liveWeather["luchtd"]
    scaledTemp = scaleTemperature(temperature)
    scaledPres = scalePressure(pressure)
    if verbose : print("Temperature: " + str(temperature) + ", pressure: "+ str(pressure))
    #timeStamp = datetime.datetime.strptime(liveWeather["time"], '%d-%m-%Y %H:%M:%S')
    unixTime = liveWeather["timestamp"]
    localTime = datetime.datetime.fromtimestamp(unixTime, datetime.timezone.utc ).astimezone()

    hRateH.addLineData([localTime], [scaledTemp], "temperature")
    hRateH.addLineData([localTime], [scaledPres], "pressure")
    hRateD.addLineData([localTime], [scaledTemp], "temperature")
    hRateD.addLineData([localTime], [scaledPres], "pressure")

    # save entry in weather file
    if not os.path.exists( weatherFileName ) :
        with open(weatherFileName, 'w') as file:
            writer = csv.writer(file, delimiter =' ')
            writer.writerow(list(liveWeather.keys()))
    with open(weatherFileName, 'a') as file:
        writer = csv.writer(file, delimiter =' ')
        writer.writerow( list(liveWeather.values()) )
    return temperature, pressure

def getSpaceWeather() :
    url = "https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json"
    j = getJSON(url)
    if len(j) < 2 : return 0, 0
    plasmaJson = dict(zip(j[0],j[-1]))
    speed = float(plasmaJson["speed"])

    url = "https://services.swpc.noaa.gov/products/solar-wind/mag-5-minute.json"
    j = getJSON(url)
    if len(j) < 2 : return 0, 0
    magJson = dict(zip(j[0],j[-1]))
    magJson.pop("time_tag")

    url = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
    j = getJSON(url)
    if len(j) < 2 : return 0, 0
    kpJson = dict(zip(j[0],j[-1]))
    kpIndex = float(kpJson["Kp"])
    kpJson.pop("time_tag")

    if verbose : print("Solar wind speed: " + str(speed) + ", Kp index: "+ str(kpIndex))

    # convert to local time
    timeStamp = datetime.datetime.strptime(plasmaJson["time_tag"], '%Y-%m-%d %H:%M:%S.%f')
    timeStamp = timeStamp.replace(tzinfo=datetime.timezone.utc).astimezone()
    #plasmaJson["time_tag"] += " UTC" #UTC time

    hRateH.addLineData([timeStamp], [scaleSolarWind(speed)], "speed")
    hRateH.addLineData([timeStamp], [scaleKpIndex(kpIndex)], "kp")
    hRateD.addLineData([timeStamp], [scaleSolarWind(speed)], "speed")
    hRateD.addLineData([timeStamp], [scaleKpIndex(kpIndex)], "kp")

    # save entry in space weather file
    if not os.path.exists( spaceFileName ) :
        with open(spaceFileName, 'w') as file:
            writer = csv.writer(file, delimiter =' ')
            writer.writerow(list(plasmaJson.keys())+list(magJson.keys())+list(kpJson.keys()) )
    with open(spaceFileName, 'a') as file:
        writer = csv.writer(file, delimiter =' ')
        writer.writerow(list(plasmaJson.values())+list(magJson.values())+list(kpJson.values()) )

    return speed, kpIndex 


ports = {}
outputDataFiles = {}

def makeText( xPos, yPos, item ) :
   text = pg.TextItem("", color='k', border='k', fill=(125, 125, 125, 100))
   text.setFlag(text.GraphicsItemFlag.ItemIgnoresTransformations)
   text.setParentItem(item)
   text.setPos(xPos,yPos)
   return text

def setText( text, textString ) :
   text.setHtml("<div style='font-size:12pt;white-space:pre;'>"+textString+"</div>")

vb = pg.ViewBox()
textWeather = makeText(400,0,vb)
textSpace = makeText(400,100,vb)
textSerial = makeText(0,0, vb)
pg_layout.addItem(vb, row=1, col=0)

def updateWeather() :
    global textWeather
    temperature, pressure = getLiveWeather()
    weatherString  = "Weather in " + weatherLocation + ":<br>"
    weatherString += "  <i>T</i> = {:0.1f} &deg;C <br>".format(temperature)
    weatherString += "  <i>p</i> = {:0.1f} mbar".format(pressure)
    setText( textWeather, weatherString )

def updateSpace() :
    global textSpace
    speed, kpIndex = getSpaceWeather()
    weatherString  = "Space weather:<br>"
    weatherString += "  <i>v<sub>wind</wind></i> = {:0.1f} km/s <br>".format(speed)
    weatherString += "  <i>K<sub>p</sub></i> = {:0.1f}".format(kpIndex)
    setText( textSpace, weatherString )

storedData = {}
def updateSerial() :
    global ports, outputDataFiles, hRateH, hRateD, hADC, textSerial, nEvts, counter
    updatePorts( ports, outputDataFiles )
    textString = ""
    for deviceID, port in ports.items() :
        while port.inWaiting() :
            line = str(port.readline(),'ascii')
            data = {"datetimes" : [], "nEvt": [], "adc": [], "uptime": [], "temp": [] }
            line = processLine( line, data ) 
            outputDataFiles[deviceID].writelines( [line] )
            outputDataFiles[deviceID].flush()
            if verbose : print( line.rstrip("\r\n") + " " + deviceID)#, end="" )
            #data["datetimes"][-1] = datetime.datetime(2025, 4, 21, 17, 12, 39, 85000)
            while data["datetimes"][-1] > hRateH.bins[-1] : hRateH.addBin()
            while data["datetimes"][-1] > hRateD.bins[-1] : hRateD.addBin()
            hRateH.addEntries( data["datetimes"], deviceID )
            hRateD.addEntries( data["datetimes"], deviceID )
            hADC.addEntries( data["adc"], deviceID )
            storedData[deviceID] = {"nEvts": data["nEvt"][-1], "uptime": data["uptime"][-1], 
                                    "temp": data["temp"][-1] }
        if deviceID not in storedData : storedData[deviceID] = {"nEvts": 0, "uptime" : 1, "temp": 0}
        rate = storedData[deviceID]["nEvts"] / storedData[deviceID]["uptime"]
        textString += "<u>" + deviceID + "</u>:<br>" 
        textString += "  <i>N</i>   = " + str(storedData[deviceID]["nEvts"]) + " hits<br>"
        textString += "  <i>t</i>     = {:0.1f} s <br>".format(storedData[deviceID]["uptime"])
        textString += "  <i>f</i>     = {:0.3f} Hz <br>".format( rate )
        textString += "  <i>T</i><sub>int</sub> = {:0.1f} &deg;C<br>".format(storedData[deviceID]["temp"])
    setText(textSerial, textString.rstrip("<br>"))

# Set a timer for the weather API
updateWeather() # get the weather initially
timerWeather = QtCore.QTimer()
timerWeather.setInterval(weatherInterval*1000)
timerWeather.timeout.connect(updateWeather)
timerWeather.start()

# Set a timer for the space weather API
updateSpace() # get the space weather initially
timerSpace = QtCore.QTimer()
timerSpace.setInterval(spaceWeatherInterval*1000)
timerSpace.timeout.connect(updateSpace)
timerSpace.start()

# Get the serial data at 10 Hz
timerSerial = QtCore.QTimer()
timerSerial.setInterval(100)
timerSerial.timeout.connect(updateSerial)
timerSerial.start()

input("press enter to quit\n")
timerWeather.stop()
timerSpace.stop()
timerSerial.stop()
